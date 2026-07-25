---
title: JS-rendered feedback is not evidence a native call succeeded — and logger.warn produces no evidence on the builds we actually test
track: knowledge
category: conventions
tags: [react-native, native-modules, ota, eas-update, observability, logging, sentry, debugging, verification]
module: client
applies_to: ["client/camera/**/*.ts", "client/camera/**/*.tsx", "client/lib/logger.ts"]
symptoms: ["A feature's animation/indicator fires but its underlying effect never happens", "A bug reproduces on device but no log line exists anywhere", "Instrumentation added to diagnose a release-build bug produces nothing", "A fix 'works' after an OTA update but the native half was never rebuilt"]
created: '2026-07-25'
---

# JS-rendered feedback is not evidence a native call succeeded — and logger.warn produces no evidence on the builds we actually test

## Rule

For any feature where **JS draws the feedback and native does the work**:

1. Treat the visible affordance as evidence of nothing but the gesture landing.
   The animation is drawn by the same JS that *requests* the native action, so
   it renders identically whether the request succeeded, rejected, or was
   swallowed.
2. Instrumentation intended to be read from a **release or OTA build must use
   `logger.error`**, never `logger.warn`/`logger.info`. In this codebase the
   latter two are `__DEV__`-only and are silent in exactly the builds we verify
   on.

## Smell patterns

- A promise-returning native call whose rejection lands in `.catch(() => {})`,
  or in a handler that only logs at `warn`/`info`.
- A plan of the form "add some logging and check the device" for a build that
  is not a dev client.
- "The UI works, so the wiring must be fine" as an argument for skipping the
  native side during triage.

## Why

**The OTA split hides it.** JS ships over-the-air via EAS Update; native code
only changes with a rebuild. A JS-only affordance therefore stays perfectly
healthy across every OTA while the native call beneath it is broken — the half
you can hot-reload keeps working and reporting success, and the half you cannot
is the half that failed. This is what made a dead `focusTo()` present as a
working tap-to-focus for weeks: the focus ring is pure JS.

**The logger tiers are inverted relative to where you look.** From
`client/lib/logger.ts`:

```ts
warn(message: string, ...args: unknown[]): void {
  if (__DEV__) console.warn(`[warn] ${message}`, ...args);   // silent in release
},
error(message: string, error?: unknown): void {
  if (__DEV__) console.error(`[error] ${message}`, error);
  else reportError(error ?? new Error(message), message);     // → Sentry
},
```

`warn` is the semantically correct severity for a recoverable native failure —
and it is precisely the level that yields **zero** evidence on a `preview` or
`production` build. When the local native toolchain is blocked (as ours has
been on fmt vs clang 21) and OTA is the only delivery path, `logger.error` is
the only channel that reaches you. Latch it if it fires from a gesture handler,
or one Sentry event per tap.

**A cheaper discriminator usually exists.** Before instrumenting, look for a
**sibling call on the same native object that has visible output**, and ask the
reporter to try it. Zoom and focus both route through VisionCamera's
`CameraController`; "does the preview image actually magnify?" proved the
controller was live and eliminated the entire not-yet-ready branch — no build,
no logging, one question. Note the care needed in phrasing it: the *zoom label*
is also JS-rendered and shows regardless, so the question had to name the
**image**, not the readout. That is the same trap one level down.

## Examples

Asking a reporter a question that discriminates, rather than one that confirms:

```
✅ "When you pinch, does the preview IMAGE magnify?"   → tests the native path
❌ "Does pinch-to-zoom work?"                          → they'll read the JS label
```

Instrumentation that survives to a release build, latched for a tap handler:

```ts
const failureReportedRef = useRef(false);

nativeCall(args).catch((error: unknown) => {
  if (failureReportedRef.current) return;
  failureReportedRef.current = true;
  logger.error(`[useCameraFocusAndZoom] focusTo failed (…device capability flags…)`, error);
});
```

Include the **inputs and the device's own capability flags** in the message, not
just the error. The rejection alone rarely says *why* the device refused.

## Exceptions

- On a dev client with Metro attached, `logger.warn` is fine and is the correct
  severity — this rule is about which build you intend to read the output from,
  not about severity in the abstract.
- Do not escalate genuinely routine conditions to `logger.error` just to make
  them visible; that pollutes Sentry. If a condition is both routine and needs
  release-build visibility, latch it hard (once per mount) as above.

## Related Files

- `client/lib/logger.ts` — the `__DEV__` gate that makes this rule necessary
- `client/lib/reporter.ts` — `reportingActive()`: DSN present **and** `!__DEV__`
- `client/camera/hooks/useCameraFocusAndZoom.ts` — latched `logger.error` precedent
- `eas.json` — `preview`/`production` profiles carry the DSN; `development` does not

## See Also

- [A library's auto-capability default can fail the whole operation](../logic-errors/library-auto-capability-default-fails-whole-operation-2026-07-25.md) — the bug that produced this rule
- [Removing a wire field needs deployed-bundle evidence](wire-field-removal-needs-deployed-bundle-evidence-2026-07-25.md) — same theme: the source tree is not the artifact under test
- [DSN-gated Sentry reporter pattern](sentry-dsn-gated-reporter-pattern-2026-05-31.md) — why `logger.error` reaches Sentry only in non-dev builds

**Not yet codified, but load-bearing for this rule:** an EAS Update applies on
the **second** cold start (the first launch downloads it in the background).
Verifying after a single relaunch reads the old bundle and produces a false
"the fix didn't work" — the most common false negative when checking an OTA fix
on device.
