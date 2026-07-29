---
title: A library's "we auto-select the supported capabilities for you" default can fail the WHOLE operation — derive the capability set at the call site
track: bug
category: logic-errors
tags: [camera, visioncamera, react-native, native-modules, capability-detection, error-handling, pinned-version, upstream-bug]
module: camera
applies_to: ["client/camera/**/*.ts", "client/camera/**/*.tsx"]
symptoms: ["Tap-to-focus animates its focus ring but the camera never actually refocuses", "The same action works in the OS camera app but not in-app", "A native promise rejects and nothing appears in any log", "The failure is total (every tap, every distance), not intermittent or range-dependent", "A sibling call on the same native controller (zoom) works fine"]
created: '2026-07-25'
severity: medium
---

# A library's "we auto-select the supported capabilities for you" default can fail the WHOLE operation — derive the capability set at the call site

## Problem

`react-native-vision-camera@5.0.11`'s `focusTo()` documents its `modes` option
as defaulting to "all `MeteringMode`s that are supported on this device — so
ideally 3A" (`AE` + `AF` + `AWB`). That reads as a safe default: the library
promises to do the capability check for you.

It does not, reliably. On 5.0.11 a metering request containing **any** mode the
device cannot perform fails the **entire** operation — auto-focus included. So
the "safe" default silently took AF down with it, and the camera stayed on
continuous auto-focus. Tap-to-focus appeared completely dead.

```js
// client/camera/hooks/useCameraFocusAndZoom.ts — before
cameraRef.current?.focusTo({ x, y }).catch(() => {
  // Devices without focus metering support reject — the ring still
  // shows for feedback; the camera falls back to continuous AF.
});
```

Two independent defects compound here. The default-modes bug is the cause; the
empty `.catch()` is why it stayed unexplained. That catch swallowed **four**
distinguishable failures — "Camera is not yet ready!", "Camera Preview is not
yet ready!", unsupported metering, and timeout/cancel — while its comment
asserted only one of them.

## Symptoms

- The focus ring animates on every tap; the preview never racks focus.
- Fails at **all** distances. (Range-dependent failure is a different bug —
  see Root Cause.)
- Pinch-to-zoom works, proving the native controller is live.
- Nothing in Metro, nothing in Sentry.

## Root Cause

Upstream fixed exactly this in **5.1.0**, under
`Check white balance mode support before metering` (#3976). The 5.1.0 release
is largely metering repairs: also `Observe metering state before requesting
changes` (#3974), `Serialize metering KVO updates on queue` (#3977), and
`Add timeout for metering tasks` (#3972). We were pinned to `^5.0.11`, which
resolved below all of them.

Two hypotheses were eliminated first, and both eliminations were cheap:

- **`minimumFocusDistance` / macro-lens selection** ([#2246]). iPhone Pro main
  lenses cannot focus closer than ~20cm, which is exactly barcode range. Ruled
  out by one question: *does it fail at a distance too?* Yes → not physical.
- **Controller lifecycle** (`focusTo` throwing "Camera is not yet ready!").
  Ruled out by asking whether **pinch-to-zoom magnifies the preview image**.
  Zoom routes through `controller?.setZoom` with optional chaining, so it
  no-ops silently when the controller is null; if the image magnifies, the
  controller is live and `focusTo` is failing further in.

That second discriminator generalizes: **to test whether a native controller is
live, exercise a different call on the same controller that has visible
output.** It needs no build and no logging.

Also verified as *not* the cause, to save the next investigator the work: the
`focusTo(viewPoint, options?)` API usage was correct (it converts view
coordinates via `createMeteringPoint` internally); the `GestureDetector` and
`<Camera>` share an origin so tap coordinates need no offset; and the outputs
array does not churn the `AVCaptureSession` (`useMemoizedArray` is
content-keyed, `usePhotoOutput` memoizes on primitives, and
`CommonResolutions.UHD_4_3` is a stable module constant).

## Solution

> **Historical — half of this shipped out on 2026-07-27.** The snippets below are
> the 5.0.11-era workaround, kept because the reasoning still explains the guard
> that survived. For what the code looks like now, read **Resolution** below
> first.

Do the capability check at the call site, deriving it from the device's own
flags — which is what `focusTo`'s own docs require of callers who pass an
explicit `modes` array ("you are responsible for ensuring that the given modes
are compatible").

```ts
// client/camera/hooks/useCameraFocusAndZoom-utils.ts
export function supportedMeteringModes(device: CameraDevice): MeteringMode[] {
  const modes: MeteringMode[] = [];
  if (device.supportsExposureMetering) modes.push("AE");
  if (device.supportsFocusMetering) modes.push("AF");
  if (device.supportsWhiteBalanceMetering) modes.push("AWB");
  return modes;
}
```

```ts
let options: FocusOptions | undefined;
if (Platform.OS === "ios") {
  const modes = supportedMeteringModes(device);
  if (modes.length === 0) return;   // iOS throws "MeteringModes cannot be empty!"
  options = { modes };
}
cameraRef.current?.focusTo({ x, y }, options)
  .then(() => { focusFailureReportedRef.current = false; })  // re-arm
  .catch((error: unknown) => {
    if (focusFailureReportedRef.current) return; // latched — this is a tap handler
    focusFailureReportedRef.current = true;
    logger.error(`[useCameraFocusAndZoom] focusTo failed (…)`, error);
  });
```

Three things this shape gets right, each of which was wrong in the first draft
and caught in review:

**1. Scope the workaround to the broken platform.** The bug is **iOS-only**.
Android's CameraX path derives its modes from
`isFocusMeteringSupported(FocusMeteringAction)` for the **actual tapped point**
(`HybridCameraController.kt:148,167`), whereas `device.supports*Metering` on
Android is a **point-agnostic** `createDummyMeteringAction(FLAG_*)` probe
(`HybridCameraDevice.kt:126-130`). Passing our flags there replaces a
point-aware check with a point-agnostic one — a *downgrade*, on the platform
that never had the bug and that wasn't device-verified. A platform-specific
workaround applied cross-platform buys symmetry and pays for it in a regression.

**2. Derive, do not hardcode.** `modes: ['AF']` would have fixed the reporting
device and silently dropped exposure and white-balance metering on every other
one.

**3. The empty guard is load-bearing, not politeness.** iOS throws
`"MeteringModes cannot be empty!"` on `[]`
(`HybridCameraController.swift:186-188`), so without it a device supporting no
metering gets a guaranteed rejection — and, with the new logging, a spurious
Sentry event — on its first tap.

Device-verified via `npm run update:preview` (PR #716). This is a **workaround
for a known upstream bug**, not the root fix — #3974/#3977 are KVO
ordering/serialization races that no JS-side change can reach, so focus can
still fail intermittently until the 5.1.1 bump lands. That bump needs a native
rebuild via EAS Build and its own verification pass, because 5.1.0 also changed
`useCameraDevice` device selection.

## Resolution — 5.1.1 landed (2026-07-27)

The bump shipped in PR 2 of `todos/P2-2026-07-25-mlkit-9-unblock-visioncamera-511.md`.
Exactly **half** of this workaround came out, which is what the last Prevention
bullet below predicted.

**Removed — upstream really did fix it.** `getAllSupportedMeteringModes()` now
gates `.awb` on `isWhiteBalanceModeSupported(.autoWhiteBalance) ||
.continuousAutoWhiteBalance` instead of appending it unconditionally
(`HybridCameraController.swift:227-240`; upstream's own comment changed to
"White Balance adjusting is not point-based, but it still requires a supported
auto mode"). The **computed** set is now correct, so the `options = { modes }`
construction is gone and we pass no modes at all.

**Kept — and the reason is stronger than "upstream didn't get to it".** The
`modes.length === 0` early return survives because the native ordering makes it
unreachable-by-default rather than redundant:

```swift
let modes = options.modes ?? self.getAllSupportedMeteringModes()  // :182
guard !modes.isEmpty else {                                       // :183
  throw RuntimeError.error(withMessage: "MeteringModes cannot be empty!")
}
```

The fallback resolves **first**, and the guard applies to the *result*. So
passing nothing does **not** bypass the throw — a device supporting no metering
still earns a guaranteed rejection (and a Sentry event) on its first tap. This
was verifiable only by reading the 5.1.1 source; the changelog does not mention
it.

**New constraint discovered at closure: the JS guard cannot be made exact.**
It is a conservative heuristic, not a mirror of the native computation, because
the two read *different AVFoundation properties*:

| Mode | Our JS flag (`HybridCameraDevice.swift:236-257`) | Native (`getAllSupportedMeteringModes`) |
|---|---|---|
| AWB | `isWhiteBalanceModeSupported(...)` | **identical** |
| AE | `isExposureModeSupported(...)` | `isExposurePointOfInterestSupported` |
| AF | `isFocusModeSupported(...)` | `isFocusPointOfInterestSupported` |

Mode support and *point-of-interest* support are distinct capabilities, and
VisionCamera exposes **no** point-of-interest flag to JS (`grep PointOfInterest
src/specs/` → zero hits), so an exact match is unreachable from the call site.
Only AWB agrees. The residual case — we allow, native throws — costs exactly one
latched log, which is why the latch above is load-bearing rather than tidy.

This also retires the "root fix" caveat: #3974/#3977 (KVO ordering and metering
serialization) are now in the binary, so intermittent focus failure should no
longer be expected. Tap-to-focus and lens selection at barcode distance are
device-verification gates on that PR, not assumptions.

## Prevention

- When a pinned library version fails a documented-as-automatic capability
  negotiation, **check that version's changelog before debugging your own
  code.** Five metering fixes shipped one minor release above our pin.
- A `.catch(() => {})` on a native promise is a defect regardless of the
  comment above it. If several distinct failures reach one handler, either
  distinguish them or log the reason — never assert one cause in a comment the
  code cannot enforce.
- Latch error reporting invoked from a gesture/tap handler. Unlatched,
  `logger.error` forwards one Sentry event **per tap** on a broken device.
- **Re-arm the latch on success.** A permanently-set latch caps *distinct
  causes* at one, not just volume. A transient early-tap rejection ("Camera is
  not yet ready!", thrown before the controller is set) would otherwise consume
  the mount's only report and hide a later persistent failure — the one worth
  knowing about. Reset it in `.then()`.
- **Before applying a workaround on every platform, confirm every platform has
  the bug.** Read the native source for each, not just the one in your hand.
  Here the Android implementation was already *more* correct than the
  workaround, so cross-platform "symmetry" would have introduced the very class
  of defect being fixed on the platform that was never verified.
- **A "delete this when upstream fixes it" note must name exactly which
  sub-behavior upstream fixes.** A workaround block accretes guards for adjacent
  problems that the upstream fix does not cover, and a bare "remove when 5.1.1
  lands" invites deleting all of them together. Here the note scoped to #3976
  (the unconditional AWB append), which corrects the *computed* mode set — but
  the block also carries the `modes.length === 0` early return, which exists
  because iOS throws `"MeteringModes cannot be empty!"` **by design**
  (a deliberate `guard`, not a defect upstream will ever "fix"). A follow-up
  todo initially inherited the unscoped wording and would have removed both.
  Caught in review of PR #717; the criterion now requires verifying the
  empty-set behavior separately before that guard comes out.

## Related Files

- `client/camera/hooks/useCameraFocusAndZoom.ts` — `runFocus`, the latched catch
- `client/camera/hooks/useCameraFocusAndZoom-utils.ts` — `supportedMeteringModes`
- `client/camera/hooks/__tests__/useCameraFocusAndZoom.test.ts` — call-contract + error-path coverage
- `package.json` / `ios/Podfile.lock` — now `^5.1.1` / GoogleMLKit root `9.0.0`
  (was the exact `5.0.11` pin this bug depended on)

## See Also

- [VisionCamera v5 attach-time gotchas](visioncamera-v5-output-identity-and-callback-staleness-2026-07-17.md) — the other v5 trap in this same hook's neighbourhood
- [JS-rendered feedback is not evidence a native call succeeded](../conventions/js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md) — why this looked like a working UI for so long
- [`<Camera zoom={SharedValue}>` requires the worklets package](../runtime-errors/vision-camera-zoom-prop-requires-worklets-package-2026-07-14.md) — the sibling zoom finding in this same hook
- [An incomplete mock is swallowed by a fire-and-forget `.catch()`](../code-quality/incomplete-mock-swallowed-by-fire-and-forget-catch-2026-07-16.md) — the same swallowing failure mode, in tests

[#2246]: https://github.com/mrousavy/react-native-vision-camera/issues/2246
