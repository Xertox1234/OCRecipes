---
title: "Resolve the GoogleMLKit 8→9 conflict blocking the VisionCamera 5.1.1 upgrade"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-08-08
archived: 2026-08-08
archived_with_residual: "AC #5's Android barcode DECODE was never verified. The upgrade is LIVE on main and everything else is confirmed — including, on Android, that the app builds, installs, launches, mounts the camera and loads the bundled MLKit barcode module. What was never observed is a barcode actually decoding through useBarcodeScannerOutput on Android. It needs a REAL ANDROID DEVICE; the emulator was proven insufficient over two sessions (adb cannot aim the virtual-scene camera, and mouse drag and WASD are both inert while the app holds the camera). Archived by explicit decision 2026-08-08 rather than left open indefinitely, because no further progress is possible without hardware that does not exist here. If Android barcode scanning is ever reported broken, THIS is the untested path — start here, not at a regression hunt."
assignee:
labels: [camera, dependencies, ios, ocr, native-build]
github_issue:
human_led: true
blocked_reason: "SHIPPED 2026-07-29 — the upgrade is LIVE on main. 7 of 8 criteria CLOSED as of 2026-08-08; the ONLY thing left is AC #5's Android barcode DECODE, which needs a real Android device (NOT the emulator — see below). Criteria #1, #2, #3, #4, #6 CLOSED; #7 tap-to-focus CLOSED 2026-08-08 on device (preview visibly refocused — the load-bearing observation, since the focus ring animating is JS-side feedback that proves nothing; this retroactively validates the workaround removal that shipped in #729 ahead of the pass); #8 close-range lens CLOSED 2026-08-08 on device (10-15cm scanning works, so 5.1.0's #4053 default-camera change does not strand barcode range on a multi-lens Pro). #728 (OCR library swap) MERGED to main as dfadf651. #729 (VisionCamera 5.1.1 + GoogleMLKit 9) MERGED to main 2026-07-29 as ed8ec449 (squash) — merged with criteria #5-Android, #7 and #8 still OPEN, so the upgrade is live and unverified in exactly those three respects. Note #728 was SQUASH-merged, which made #729 read as CONFLICTING — same content via two paths, not a real conflict; resolved with a `-s ours` merge of main, verified byte-identical by tree hash to a clean rebase. The Release-configuration build blocker is CLEARED 2026-07-27 (BUILD SUCCEEDED, 0 errors, zero LLVM-verify-pass crashes and zero frontend ICEs — the -Onone carve-out survived the pod change); note it is a Release SIMULATOR build, a proxy for and not equivalent to a signed EAS device archive. DEVICE PASS RUN 2026-07-28: a VisionCamera 5.1.1 codegen regression aborted the app on camera mount (SIGABRT) — FIXED via patch-package in 34d75bef. AC #4 then CLOSED on device (Cherry Coke 06772408: Trust-the-Label conflict UI, Label column 140 kcal matching the can) — MLKit 9 TextRecognition confirmed compatible, and the first runtime verification of PR #695. No correctness defect blocks #729. Remaining work is device-only coverage, unreachable by any autonomous executor: #5 barcode on Android — NARROWED 2026-08-08 to the DECODE only: the Android build, install, launch and CAMERA MOUNT all PASSED on the emulator (session OPEN, bundled MLKit barcode module loaded, zero crashes), and the #729 prediction that Android would hit the same enableJsiParser crash is RETIRED; what remains is getting a barcode into the virtual-scene camera's view — and that is NOT achievable on the emulator (proven over two sessions 2026-08-08: adb cannot aim the scene camera, and mouse drag and WASD are both inert while the app holds the camera), so the decode needs a REAL ANDROID DEVICE or a non-virtualscene camera-injection route; do not retry on the emulator (iOS half PASSED), #7 tap-to-focus (not exercisable in the barcode flow — it auto-advances; use a no-barcode HUNTING state), #8 useCameraDevice lens selection at 10-15cm (normal range PASSED). RESIDUAL RISK NOW CARRIED ON MAIN: patches/react-native-vision-camera+5.1.1.patch is load-bearing — it restores the enableJsiParser flag VisionCamera 5.1.1 dropped, and without it the camera aborts (SIGABRT) on mount. The upstream regression was still NOT reported as of 2026-08-08 and 5.2.0 carries the same bug, so any future VisionCamera bump must carry this patch forward or silently re-break camera mount. Device testing needs a native build at runtimeVersion 1.2.0; an OTA can neither deliver nor validate any of this."
---

# Resolve the GoogleMLKit 8→9 conflict blocking the VisionCamera 5.1.1 upgrade

## ⛔ ARCHIVED 2026-08-08 — 7 of 8 criteria closed, one residual left UNVERIFIED

**This todo is closed by decision, not by completion.** The dependency migration
it exists for is DONE and LIVE on `main` (#728, #729). Seven of eight acceptance
criteria are verified, several on physical hardware.

**The one thing never verified: a barcode actually DECODING on Android.**
`useBarcodeScannerOutput` has never produced a result. Everything up to that
point is confirmed on Android — build, install, launch, camera mount, and the
bundled MLKit barcode module loading in-process — so the untested surface is
narrow, but it is real and it is shipped.

It was archived rather than left open because **no further progress is possible
without hardware that does not exist here**: the decode needs a real Android
device, and the emulator was proven insufficient over two sessions (`adb` cannot
aim the virtual-scene camera; mouse drag and WASD are both inert while the app
holds the camera).

> **If Android barcode scanning is ever reported broken, start HERE.** This is
> the one path in the 5.1.1 + MLKit 9 upgrade that was never observed working.
> Do not begin with a regression hunt — begin by assuming this was never proven.

---

### Original resume notes (historical)

**2026-08-08 — 7 of 8 criteria are CLOSED. One item remains: AC #5's Android
barcode DECODE, and it needs a REAL ANDROID DEVICE.** The emulator has been
proven insufficient for it over two sessions (see the emulator entries below) —
do not retry there. Everything else is done: the upgrade shipped in #729, and
every iOS criterion has now been verified on hardware.

✅ **AC #7 (tap-to-focus) CLOSED 2026-08-08 — the preview visibly refocused.**
That was the whole point of the upgrade, and it is the correct pass condition:
the focus ring animating would not have counted (JS-side feedback, renders on
tap regardless of the native result — how the original defect hid). It also
retroactively validates the metering-workaround removal that shipped in #729
_ahead_ of the device pass. Residual unchanged: the empty-set guard is still
untested by design — it fires only on a device supporting no metering at all.

✅ **AC #8 (close-range lens) CLOSED 2026-08-08** — 10–15 cm scanning works on
the multi-lens Pro Max, so 5.1.0's #4053 default-camera change does not strand
barcode range.

**2026-07-28 — DEVICE PASS RUN. One blocker found and FIXED; AC #4 CLOSED.**
The device session is no longer pending — it happened. Read this before the
older text below, which predates it. **No correctness defect blocks the merged
code; only device coverage remains (AC #5 Android, #7, #8).**

**(1) FIXED — the app crashed (SIGABRT) on camera mount.** VisionCamera 5.1.1's
nitrogen codegen dropped `RawPropsParser(/* enableJsiParser */ true)`, so its
`jsi::Value`-typed props were parsed from `folly::dynamic` and every cast hit
`react_native_assert(false)` at `RawValue.h:453`. Fixed by
`patches/react-native-vision-camera+5.1.1.patch` (commit `34d75bef`) via
patch-package. Upstream regression — `react-native-nitro-image` still emits it
correctly, nitro is unchanged, and **5.2.0 carries the same bug**, so a version
bump is not the fix. Camera now opens; scan flow runs steps 1→3 end to end.

**(2) ✅ AC #4 CLOSED — OCR + label override VERIFIED on device.** Cherry Coke
(`06772408`): the conflict UI rendered **Label vs Database side by side**, with
the Label column reading **140 kcal — matching the physical can**. Full chain
confirmed: MLKit 9 read the panel → `parseNutritionFromOCR` extracted it →
`buildLabelConflict` flagged the conflict → `chooseSource()` offered both.
**This is the first runtime verification of PR #695 "Trust the Label"** (merged
2026-07-24 with client runtime never verified), on the exact product it was
written for. OFF's record for this barcode is wrong — every field ~3.8× low
(`energy-kcal_serving: 39.4`) — so the override is doing real work here.

⚠️ An earlier scan in the same session showed the wrong 39 kcal with **no**
conflict UI. Since the override demonstrably works, that capture simply yielded
no usable OCR text. That exposes a **pre-existing, non-blocking** defect worth a
follow-up: the empty-OCR path is SILENT. `ocrText: action.ocrText ?? ""` then
`ocrText ? parse : null` means an unreadable label falls through to the DB with
no error and no hint it was ignored — indistinguishable from success, and on a
product whose DB record is badly wrong it presents a bogus calorie count as if
verified. Surface "couldn't read the label — try again" instead.

**#729 is NOT blocked by any correctness defect.** What remains is coverage:
AC #5 Android barcode, AC #7 tap-to-focus, AC #8 close-range lens.

Full analysis in the #729 comment thread. Everything below is older history and
evidence; the build/CI claims there remain accurate.

**2026-07-28 — the hardware blocker is CLEARED.** The iPhone is tethered and
`xcrun devicectl list devices` reports `available (paired)`: **iPhone 16 Pro Max
(iPhone17,2), iOS 18.7.8** — which is the _right_ hardware for check 2, the
multi-lens case that a single-lens phone cannot exercise. Android is reachable
too, without a physical device (see check 3). ⚠️ `xcrun xctrace list devices`
lists the phone under "Devices Offline" even when it is fine — `devicectl` is
authoritative; do not chase that.

### State

|                                         |                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **#728** — OCR library swap             | **MERGED** to `main` as `dfadf651` (live)                                                                                                      |
| **#729** — VisionCamera 5.1.1 + MLKit 9 | **MERGED** to `main` 2026-07-29 as `ed8ec449` (squash); branch `feat/visioncamera-511-mlkit-9` deleted                                         |
| What `main` ships now                   | VisionCamera + `-barcode-scanner` 5.1.1, single `GoogleMLKit` root 9.0.0, MLKitVision 10.0.0, `patches/react-native-vision-camera+5.1.1.patch` |
| Debug sim build (AC #6)                 | ✅ 0 errors                                                                                                                                    |
| Release build                           | ✅ 0 errors — optimizer carve-out intact (simulator destination, NOT a signed EAS archive)                                                     |
| Criteria closed                         | #1, #2, #3, #4, #6 (5 of 8) — #4 closed on device 2026-07-28                                                                                   |
| Criteria still OPEN on shipped code     | **#5 (Android), #7 (tap-to-focus), #8 (close-range lens)** — device-only                                                                       |
| Device blocker                          | ✅ SIGABRT on camera mount — FIXED (`34d75bef`, patch-package)                                                                                 |

### To resume

```bash
# The branch is DELETED and the upgrade is already on main — just build main.
git checkout main && git pull

# iOS — checks 1, 2, 4. Tether + unlock first; run tethered, not untethered:
# check 1 depends on reading console output live over the cable.
npx expo run:ios --device
npm run server:dev             # backend, for the parsed-macros half of check 4

# Android — check 3. Boot WITH camera passthrough, then build onto it.
emulator -avd Medium_Phone_API_36.1 -camera-back webcam0 -gpu host
npx expo run:android           # targets the already-running emulator
```

Console line to watch on iOS (check 1): `[useCameraFocusAndZoom] focusTo failed`.
Any occurrence is a real finding — it prints the device's AE/AF/AWB support
flags, which is what distinguishes a metering problem from a plain focus miss.

**Do not attempt to exercise the empty-set metering guard on real hardware.** It
fires only on a device supporting _no_ metering at all; every modern iPhone
supports all three modes. That branch is retained on the strength of reading
`HybridCameraController.swift`, not a device test. Check 1 verifies the _normal_
path — that dropping the explicit `modes` array did not break ordinary focus.

Then run the device checklist — priority order, full pass/fail detail in
Acceptance Criteria below and in the #729 comment thread:

1. **Tap-to-focus (AC #7)** — the reason this upgrade exists. Pass = the
   **preview image visibly racks focus**. ⚠️ The focus ring animating is NOT
   evidence; it is JS-side feedback rendered on tap regardless of whether the
   native promise resolved. That is precisely how the original bug stayed
   invisible.
2. **Barcode at 10–15 cm (AC #8)** — highest regression risk. 5.1.0's #4053
   changed `useCameraDevice` defaults, and Pro main lenses cannot focus closer
   than ~20 cm (upstream #2246), which is inside barcode range. A multi-lens
   device (e.g. iPhone 16 Pro Max) is the right hardware to catch this; a
   single-lens phone passes trivially and proves nothing.
3. **Barcode on Android (AC #5)** — `useBarcodeScannerOutput`, a genuinely
   different code path. **No physical Android device is needed** (verified
   2026-07-28): the `Medium_Phone_API_36.1` AVD exists and the emulator exposes
   host-camera passthrough (`emulator -webcam-list` → `webcam0`, `webcam1`), so
   the emulator can see a real barcode held up to the Mac's camera. The emulator
   runs the real Android MLKit library and genuinely executes the
   `useBarcodeScannerOutput` path — which is the whole point of this criterion
   (it is a _different code path_, not different hardware). What it cannot cover
   is Android camera **hardware** behavior: autofocus quality, lens choice, low
   light. Treat that as a documented residual, not a blocker.

   ⚠️ **This also compiles Android for the first time on this upgrade.** Every
   build in AC #6 is iOS. `react-native-vision-camera-barcode-scanner`
   5.0.11 → 5.1.1 moves the **Android** MLKit Gradle dependency too, and nothing
   has verified that resolves and compiles. Run this even if barcode testing
   were skipped — a Gradle resolution failure surfaces here, before any scan.

4. **OCR on a real nutrition label (AC #4)** — parsed macros, not "text came
   back." Lowest risk: TextRecognition headers are byte-identical 8.0.0 → 9.0.0.

Items 1 and 2 are the load-bearing pair — 1 is the reason for the bump, 2 is the
only way it could make things worse. 3 and 4 are regression smoke tests.

### 🚫 Do NOT deliver this via OTA

`runtimeVersion` is bumped 1.1.0 → **1.2.0** in #729 specifically to prevent it.
EAS Update ships only the JS bundle, so it cannot carry MLKit 9 or VisionCamera
5.1.1 — but it **would** ship the metering surgery in `useCameraFocusAndZoom.ts`,
which calls `focusTo({x,y})` with no modes. That is correct **only** against
5.1.1's native default computation; on a 5.0.11 binary it re-triggers the
unconditional-AWB bug this whole todo exists to fix. Device testing requires a
native build, not `npm run update:preview`.

### Two traps already paid for — do not rediscover them

- **`pod install` REFUSES this bump by design.** `Podfile.lock` is a snapshot
  constraint; crossing a native major needs an explicit `pod update <family>`,
  and it cascades one conflict at a time. Codified in
  `docs/solutions/best-practices/podfile-lock-snapshot-refuses-native-major-pod-update-cascades-2026-07-27.md`.
- **A Release build fails on the Sentry source-map upload phase**
  (`error: Project not found`) — a Release-only phase, invisible in Debug, and a
  missing local credential rather than a defect. Use
  `SENTRY_DISABLE_AUTO_UPLOAD=true`.

### After the device pass

⚠️ Superseded 2026-07-29: #729 is already merged, so these checks can no longer
gate a merge — they can only confirm or refute what shipped. If all three
remaining checks pass, archive this todo to `todos/archive/`. If **tap-to-focus
(AC #7) fails**, the bump did not achieve its purpose and the defect is already
on `main` awaiting the next native build — treat that as a regression to fix,
not a follow-up to file.

---

## Summary

`react-native-vision-camera` cannot move off the pinned 5.0.11 because
`VisionCameraBarcodeScanner@5.1.1` requires `GoogleMLKit/BarcodeScanning = 9.0.0`
while `@react-native-ml-kit/text-recognition@2.0.0` pins
`GoogleMLKit/TextRecognition* = 8.0.0`. GoogleMLKit subspecs share one root
version, so the two cannot coexist and `pod install` fails outright.

## Background

Discovered 2026-07-25 while attempting the 5.1.1 bump that is the **root fix**
for the tap-to-focus defect worked around in PR #716 (merged as `e6ecf52c`).

PR #716 filters metering modes at the call site on iOS, which is a workaround
for upstream #3976. But VisionCamera 5.1.0 also shipped
[#3974 `Observe metering state before requesting changes`] and
[#3977 `Serialize metering KVO updates on queue`] — AVFoundation KVO
ordering/serialization races that **no JS-side change can reach**. Until the
bump lands, tap-to-focus can still fail intermittently even with #716 merged.

Exact failure from `pod install --project-directory=ios`:

```
[!] CocoaPods could not find compatible versions for pod "GoogleMLKit/BarcodeScanning":
  In snapshot (Podfile.lock):
    GoogleMLKit/BarcodeScanning (= 8.0.0)
  In Podfile:
    VisionCameraBarcodeScanner (from `../node_modules/react-native-vision-camera-barcode-scanner`)
      was resolved to 5.1.1, which depends on GoogleMLKit/BarcodeScanning (= 9.0.0)
```

### Already investigated — do not redo

- **The npm side needs no changes — but is NOT safely pinned.** Both
  `react-native-vision-camera` and `-barcode-scanner` publish 5.1.1. Peer deps
  are all `*`; `react-native-nitro-modules` (0.35.6) and
  `react-native-nitro-image` (0.14.0) do **not** need to move. The blocker is
  entirely at the CocoaPods layer.
  **⚠ Latent trap — MITIGATED 2026-07-26 (see Updates), not resolved.** Both
  packages are now exact-pinned to `5.0.11` in `package.json` (was `^5.0.11`,
  and the caret already permitted 5.1.1) and blocked at `>=5.1.0` in
  `.github/dependabot.yml`. Note the CocoaPods failure is loud, but it surfaces
  at native build time, not at `npm install` — and CI has no native build step,
  so a bump goes green in CI and only breaks on an EAS Build.
- **The MLKit 9 requirement starts at 5.1.0, not 5.1.1.** Verified against the
  published 5.1.0 podspec: `s.dependency 'GoogleMLKit/BarcodeScanning', '9.0.0'`.
  The `pod install` transcript below happens to name 5.1.1 because that is what
  the caret resolved to; there is **no safe 5.1.0 stepping stone** to try first.
- **`@react-native-ml-kit/text-recognition` has no MLKit 9 release.** Installed
  2.0.0 is the latest published version; its podspec hard-pins five subspecs at
  `8.0.0` (`RNMLKitTextRecognition.podspec:25-33`: TextRecognition, Chinese,
  Devanagari, Japanese, Korean).
- **Deployment target is NOT a blocker.** `GoogleMLKit` 9.0.0 requires iOS 15.5;
  `ios/Podfile.properties.json` already sets `"ios.deploymentTarget": "15.5"`.
  (The `'15.1'` in `ios/Podfile:21` is only the fallback when that key is absent.)
- **Dropping the barcode-scanner pod is NOT viable.** `CameraView.ios.tsx`
  already avoids it (uses `useObjectOutput` / AVFoundation metadata objects),
  but `CameraObjectOutput` is `@platform iOS` with no Android implementation —
  `CameraView.tsx` genuinely needs `useBarcodeScannerOutput` on Android. The
  VisionCamera family is also version-locked as a set (shared generated Nitro
  specs), so leaving `-barcode-scanner` at 5.0.11 while core goes to 5.1.1 is
  not a supported configuration.

## Acceptance Criteria

- [x] A decision is recorded on which option below is taken, and why
      — **Option 3**, decided 2026-07-27. See Updates.
- [x] `pod install` completes with `GoogleMLKit` resolved to a single root version
      — **satisfied at root 9.0.0 by PR 2**, verified against the regenerated
      `ios/Podfile.lock`: `GoogleMLKit/{MLKitCore,BarcodeScanning,TextRecognition}`
      all `(9.0.0)`.
      (PR 1 also satisfied this _literally_, at root 8.0.0 — the criterion was
      written assuming 9.0.0 was the only way to reach a single root, which it is
      not. It was deliberately left unticked then so PR 2 had to re-satisfy it.)
      Note `pod install` alone **refuses** this bump by design: `Podfile.lock` is
      a snapshot constraint, so crossing a native major requires an explicit
      `pod update GoogleMLKit MLKitVision MLKitBarcodeScanning
MLKitTextRecognition MLKitTextRecognitionCommon MLKitCommon`.
- [x] `react-native-vision-camera` + `-barcode-scanner` both at 5.1.1, with
      `ios/Podfile.lock` regenerated and committed — **done in PR 2** (`8f30a5f0`).
      Full resolved set: `MLKitBarcodeScanning` 7→8, `MLKitTextRecognition` 6→7,
      `MLKitTextRecognitionCommon` 5→6, `MLKitCommon` 13→14, `MLKitVision` 9→10.
      `RNMLKitTextRecognition (5.0.1)` and `RNMLKitCore (3.1.0)` are **unchanged**
      — they resolved against MLKit 9 without a version bump, which is the whole
      payoff of PR 1's unpinned podspec.
- [x] OCR still works end-to-end: nutrition-label capture → `recognizeTextFromPhoto`
      → parsed macros (this is the app's core scan path — MLKit 9's
      TextRecognition API must be verified, not assumed compatible)
      — **VERIFIED ON DEVICE 2026-07-28** (iPhone 16 Pro Max, iOS 18.7.8), on
      Cherry Coke `06772408`. The Trust-the-Label conflict UI rendered Label vs
      Database side by side with the Label column at **140 kcal, matching the
      physical can**. That output is only reachable if MLKit 9 supplied calories + a macro + a parseable serving size, so the TextRecognition 6→7 bump is
      confirmed compatible — not assumed. Doubles as the first runtime
      verification of PR #695, whose client path had never been exercised.
- [ ] Barcode scanning verified on **both** iOS and Android (iOS uses
      `useObjectOutput`, Android uses `useBarcodeScannerOutput` — different code paths)
      — **iOS half PASSED on device 2026-07-28.** **Android BUILD half PASSED
      2026-08-08** (`./gradlew assembleDebug` → `BUILD SUCCESSFUL in 5m 18s`,
      0 resolution failures; `barcode-scanning:17.3.0` and `text-recognition:16.0.1`
      coexist in `debugRuntimeClasspath`; `libbarhopper_v3.so` +
      `libmlkit_google_ocr_pipeline.so` packaged for all 4 ABIs — see Updates).
      **Android CAMERA-MOUNT half also PASSED 2026-08-08** on the emulator:
      camera session `OPEN | Error: null`, scan UI live, and the bundled MLKit
      barcode module loaded in-process (`DynamiteModule: Selected local version
of com.google.mlkit.dynamite.barcode`), zero crashes.
      **Still open — the DECODE only:** no barcode has been decoded, so
      `useBarcodeScannerOutput` has never produced a result.
      ⛔ **NOT achievable on the emulator — do not retry there** (proven over two
      sessions, 2026-08-08). The virtual-scene camera cannot be aimed at the
      injected poster by ANY means: `adb` cannot drive it, and **mouse drag and
      WASD are both inert** while the guest app holds the camera.
      `adb emu virtualscene-image` swaps only the texture on the two fixed
      surfaces (`wall`, `table`). **This needs a real Android device**, or a
      camera-injection route other than virtualscene. See Updates.
- [x] iOS 26 simulator build still works (see the MLKit fat-binary risk below)
      — **RE-VERIFIED 2026-07-27 on PR 2, against the MLKit 9 framework set.**
      Full Debug build on a booted iPhone 17 (iOS 26): `** BUILD SUCCEEDED **`,
      **0 errors** (1197 warnings, 51,466 log lines), app binary `arm64`,
      `LatinOCRResources.bundle` present, and all 11 MLKit/VisionCamera pod
      products built — including `RNMLKitTextRecognition` and `RNMLKitCore`
      linking against MLKit 9 unchanged.
      The proof that `scripts/patch-mlkit-simulator.py` handled the **changed**
      framework set (MLKitVision 9→10 etc.) is that on an arm64-only simulator a
      failure to re-tag surfaces as a hard link error: zero occurrences of
      "building for iOS Simulator, but linking in object file built for iOS" and
      zero "excluded architecture" complaints.
      PR 1's green build was deliberately NOT carried forward as evidence here —
      it covered a different framework set.
      **Release-configuration build also DONE 2026-07-27**: `** BUILD SUCCEEDED **`,
      0 errors, all 10 MLKit/VisionCamera products built at Release, **72
      VisionCamera Swift compiles succeeded**, `LatinOCRResources.bundle` present
      and zero script-pack bundles. Both documented Swift 6.2 failure signatures
      absent: **0** `Global is external, but doesn't have external or weak
linkage` (the LLVM verify-pass crash) and **0** frontend ICEs — i.e. the
      `-Onone` / `singlefile` carve-out at `ios/Podfile:204-211` still lands on
      the VisionCamera targets after the pod change. Debug could never have shown
      this: Debug is `-Onone` anyway, so the optimizer never runs.
      ⚠️ **Trap for whoever runs the EAS build:** the FIRST Release attempt
      FAILED with 3 errors, none of them compilation — the **Sentry source-map
      upload** script phase (`error: Project not found`). That phase runs only in
      Release, so it is invisible in every local Debug build, and it is a missing
      local credential rather than a code defect (Sentry prod upload is
      deliberately unconfigured until a store build). Re-ran clean with
      `SENTRY_DISABLE_AUTO_UPLOAD=true`.
      ⚠️ **Scope limit — this is a proxy, not the EAS path.** It is a Release
      build for a _simulator_ destination (binary is `x86_64 arm64`), not a
      signed device archive; an EAS archive additionally does device-arch
      codegen, dSYM generation, and symbol stripping. It closes the specific
      documented optimizer failure mode, not the whole archive pipeline.
- [x] Tap-to-focus re-verified on a physical device; then remove the
      `Platform.OS === "ios"` workaround branch in
      `client/camera/hooks/useCameraFocusAndZoom.ts` and its
      `supportedMeteringModes()` helper
      (`client/camera/hooks/useCameraFocusAndZoom-utils.ts`) — **but only the
      part upstream actually fixed.** The "delete when 5.1.1 lands" note scopes
      to #3976, the unconditional-AWB-append bug, which makes the _computed_
      mode set correct. It says nothing about the _empty_ set: iOS throws
      `"MeteringModes cannot be empty!"` by design
      (`HybridCameraController.swift:186-188`, a deliberate `guard`, not a
      defect), so a device supporting no metering at all still needs handling.
      Confirm 5.1.1's behavior for that case **before** dropping the
      `modes.length === 0` early return, or a no-metering device gets a
      guaranteed rejection plus a Sentry event on its first tap — the exact
      failure `docs/solutions/logic-errors/library-auto-capability-default-fails-whole-operation-2026-07-25.md`
      flags as load-bearing
      → **CODE HALF DONE in PR 2 (`8f30a5f0`); this box stays unticked pending
      the on-device pass.** The 5.1.1 source was read before editing, and it
      settled the question in both directions:
      • **#3976 confirmed fixed** — `getAllSupportedMeteringModes()` now gates
      `.awb` on `isWhiteBalanceModeSupported(...)` instead of appending it
      unconditionally, so the `options = { modes }` construction was removed.
      • **The empty-set guard was KEPT, and the note above was right to insist.**
      `HybridCameraController.swift:182-185` resolves
      `options.modes ?? getAllSupportedMeteringModes()` **first** and only then
      applies `guard !modes.isEmpty` — so passing no modes does **not** bypass
      the throw. `supportedMeteringModes()` therefore stays too; the earlier
      "remove the helper" wording is superseded.
      • **New:** the guard _cannot_ be made exact. Our `supports{Exposure,Focus}
Metering` flags derive from `is*ModeSupported()`, while native reads
      `is*PointOfInterestSupported()`, and VisionCamera exposes no
      point-of-interest flag to JS. Only AWB agrees. Details in the solution
      doc's new Resolution section.
      → **CLOSED 2026-08-08 on device (user-reported).** Pass condition met as
      written: **the preview image visibly refocused.** That is the load-bearing
      observation — the focus ring animating would NOT have counted, since it is
      JS-side feedback rendered on tap regardless of whether the native promise
      resolved, which is exactly how the original defect stayed invisible
      (`docs/solutions/conventions/js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md`).
      **This retroactively validates a removal that is already live on `main`:**
      the criterion was written as "verify, THEN remove the workaround", but the
      `options = { modes }` removal shipped in #729 ahead of the device pass. It
      is now confirmed correct rather than assumed.
      The **empty-set guard remains untested and deliberately so** — it fires
      only on a device supporting no metering at all, which no modern iPhone is;
      it is retained on the strength of reading `HybridCameraController.swift`,
      not a device test. That residual is unchanged by this pass.
- [x] `useCameraDevice` device selection re-verified — 5.1.0 shipped
      "Better `useCameraDevice(...)` including default Cameras" (#4053), a
      behavioral change to which physical camera gets picked
      → **CLOSED 2026-08-08 on device (user-reported): close-range scanning
      works.** This is the case that mattered — 5.1.0's #4053 changed default
      camera selection, and Pro main lenses cannot focus nearer than ~20 cm
      (upstream #2246), which is inside barcode range. A multi-lens iPhone 16 Pro
      Max is the hardware that can actually fail this; it passed, so the new
      default selection does not strand barcode scanning at close range.

## Implementation Notes

Options, roughly in increasing order of cost:

1. **Wait for upstream.** File/track an issue on
   `@react-native-ml-kit/text-recognition` asking for an MLKit 9 release. Zero
   work, unbounded latency, and it's a small project — check its activity before
   betting on this.
2. **Patch the podspec locally** (`patch-package` or a `postinstall`) to move
   its five `8.0.0` pins to `9.0.0`. Cheapest path that unblocks today, but it
   asserts API compatibility across an MLKit major — verify
   `MLKitTextRecognition`'s Swift/ObjC surface actually didn't break, don't
   assume from a successful `pod install`.
3. **Replace `@react-native-ml-kit/text-recognition`** with a maintained
   alternative on MLKit 9, or with Apple's Vision framework via a small Expo
   module on iOS. Biggest change, removes the coupling permanently.

Risks/notes for whoever picks this up:

- **The MLKit fat-binary patcher is the sharpest edge.** `ios/Podfile:62-100`
  strips `EXCLUDED_ARCHS[sdk=iphonesimulator*]` and installs a
  `[MLKit] Patch for platform` build phase that runs
  `scripts/patch-mlkit-simulator.py` on **every build** to re-tag MLKit binaries
  per platform (iOS 26 simulators are arm64-only; MLKit ships arm64 tagged for
  device). An MLKit major bump can change framework layout/packaging and break
  that script. Budget time for it and re-read
  `docs/solutions/best-practices/visioncamera-5-upgrade-ios-xcode26-build-2026-06-02.md`.
- **Verification needs a native build, not OTA.** This is a native change; an
  OTA update cannot deliver or validate it.
  **Updated 2026-07-26 — the local iOS build is NO LONGER blocked.** The
  fmt-vs-clang-21 break was root-caused and fixed by a `post_install` patch in
  `ios/Podfile` (PR #725); a clean simulator build with fresh DerivedData now
  passes in ~5.5 min. So a **local simulator build covers Acceptance Criteria
  #2, #3 and #6** — only a Release archive / store build still needs EAS.
  Criteria #4, #5, #7 and #8 remain physical-device work regardless (real label
  photos, both barcode code paths, tap-to-focus, multi-lens selection).
  If a clean build fails on `consteval` in `fmt/format-inl.h` again, check
  whether that Podfile hook is still present and matching fmt's current source.
- Do **not** run `npm audit fix` while touching the lockfile — use `package.json`
  `overrides` per `project_dependabot_transitive_override_remediation`.

## Scope Contract

- **Mechanisms to use:** dependency version changes, a podspec patch via
  `patch-package`/`postinstall` **or** a library swap — whichever option is
  chosen and recorded. Removal of the now-obsolete iOS metering workaround.
- **Files in scope:** `package.json`, `package-lock.json`, `ios/Podfile.lock`,
  `.github/dependabot.yml` (the `>=5.1.0` ignore entries must be REMOVED as part
  of the real upgrade — see Updates 2026-07-26),
  `ios/Podfile` (only if the MLKit patch phase needs adjusting),
  `scripts/patch-mlkit-simulator.py`, `client/camera/hooks/useCameraFocusAndZoom.ts`,
  `client/camera/hooks/useCameraFocusAndZoom-utils.ts` and their tests, plus
  `client/camera/utils/recognizeTextFromPhoto.ts` if the OCR library is replaced.
- No unrelated camera refactors. Do not convert zoom to the declarative
  `<Camera zoom={...}>` prop while in here — it throws without
  `react-native-vision-camera-worklets` and kills the preview
  (`docs/solutions/runtime-errors/vision-camera-zoom-prop-requires-worklets-package-2026-07-14.md`).

## Dependencies

- None blocking, but PR #716 (merged) ships the interim workaround, so this is
  not urgent — it removes an intermittent-failure tail, not a hard breakage.

## Risks

- MLKit 9 may change the TextRecognition API surface. OCR is the app's core
  scan path; a silent accuracy regression here is worse than the focus bug this
  upgrade is meant to finish fixing. Verify against real label photos, not just
  a green build.
- The `patch-mlkit-simulator.py` pipeline is bespoke and load-bearing for iOS 26
  simulator builds. If MLKit 9 restructures its frameworks, this todo grows
  substantially.
- 5.1.0's `useCameraDevice` change could alter which physical camera is selected
  on multi-lens iPhones — relevant to the `minimumFocusDistance` / macro-lens
  behavior at barcode range. Verify close-range scanning explicitly.

## Updates

### 2026-07-25

- Initial creation. Discovered while attempting the 5.1.1 bump as the root fix
  for the PR #716 tap-to-focus defect; the bump was reverted cleanly (no commits
  made) once the MLKit conflict proved to be a dependency migration rather than
  a version bump.

### 2026-07-26 — latent trap mitigated; todo stays OPEN

A `/todo-fast` run stopped at the `human_led` gate as designed. Rather than
override it, the scope was narrowed by explicit human decision to **only** the
latent-trap mitigation flagged above. **No option 1/2/3 decision was made** —
Acceptance Criterion #1 is still open and still human-led.

**What changed** (branch `fix/pin-vision-camera-5-0-11`):

- `package.json`: `react-native-vision-camera` and
  `react-native-vision-camera-barcode-scanner` moved from `^5.0.11` to an exact
  `5.0.11`. Matches the file's existing convention (`react-native`,
  `react-native-keyboard-controller` are already exact-pinned).
- `package-lock.json`: regenerated with `npm install --package-lock-only` so
  `node_modules` was untouched and no unrelated resolution drift entered the
  diff. Only the root `packages[""].dependencies` range changed; `resolved`
  stayed 5.0.11.
- `.github/dependabot.yml`: two `ignore` entries at `>=5.1.0`, with the full
  rationale inline. This is the layer that matters for the remaining vector —
  the repo runs `open-pull-requests-limit: 0`, so version-update PRs were
  already off, but **security** updates bypass that limit and could otherwise
  bump into 5.1.x on any CVE.

**New finding, not in the original writeup:** the MLKit 9 requirement begins at
**5.1.0**, not 5.1.1 — verified against the published 5.1.0 podspec
(`s.dependency 'GoogleMLKit/BarcodeScanning', '9.0.0'`). Anyone hoping to take
5.1.0 as a smaller intermediate step should not bother.

**⚠ REVERT ME when doing the real upgrade.** The exact pins and the two
dependabot `ignore` entries are holding measures, not constraints to design
around. Undo both as the first step of whichever option is chosen; the carets
can go back to `^` once GoogleMLKit resolves to a single root version.

**Not verified, and out of the narrowed scope:** nothing native was built or
run. `ios/Podfile.lock` is untouched and still records
`GoogleMLKit/BarcodeScanning (8.0.0)` / `VisionCamera (5.0.11)`. No OCR,
barcode, tap-to-focus, or `useCameraDevice` verification was attempted — all of
it needs an EAS Build and a physical device.

> ⚠️ **The paragraph above is SUPERSEDED as of 2026-07-27** — see the next
> Updates entry. `ios/Podfile.lock` has since been regenerated and a local iOS
> simulator build succeeded (0 errors). `VisionCamera (5.0.11)` is still
> accurate and deliberate; "nothing native was built or run" is not.

### 2026-07-27 — DECISION: Option 3. Split into two PRs.

**Option 3 (replace the OCR library) is chosen.** Acceptance Criterion #1 closed.

**Option 1 (wait for upstream) is dead, not merely slow.**
`@react-native-ml-kit/text-recognition` is still `2.0.0`, last published
**2025-09-01** (~11 months stale); its repo `a7medev/react-native-ml-kit` last
committed 2025-09-06. There is no newer fork on npm.

**Option 2 (patch the podspec) was rejected** because it means carrying a
locally-forked podspec across an MLKit major, in a repo with no `patches/` or
`patch-package` infrastructure, and it leaves the coupling permanently in place.

**Replacement: `@infinitered/react-native-mlkit-text-recognition@^5.0.1`.** Its
podspec declares `GoogleMLKit/TextRecognition` with **no version constraint**,
so CocoaPods floats it to whatever root the barcode scanner demands. The
conflict dissolves by _removing_ a pin rather than replacing a technology — and
it makes the GoogleMLKit root version a free variable, which is what makes the
VisionCamera bump independently revertible.

Findings that made this cheap (all verified, not assumed):

- **The four script packs were dead weight.** `recognizeTextFromPhoto` never
  passed the `script` param, so it always ran `LATIN`. Infinite Red being
  Latin-only is not a capability loss — it deleted four unused MLKit binaries
  and four OCR resource bundles from the app.
- **No MLKit API break to absorb.** GoogleMLKit 8.0.0 → 9.0.0 TextRecognition
  Obj-C/Swift headers are byte-identical (`MLKTextRecognizer.h`,
  `MLKTextBlock.h`, diffed from the shipped tarballs).
- **The conflict is iOS-only.** Gradle resolves `com.google.mlkit:text-recognition`
  and `:barcode-scanning` as independent Maven coordinates — no shared-root
  constraint. Android needed no changes.
- **`scripts/patch-mlkit-simulator.py` needed zero changes** — it walks every
  `*.framework` under `ios/Pods` and self-selects; there is no framework list.

**PR 1 (this branch) — OCR library swap only.** VisionCamera deliberately stays
at 5.0.11 so the GoogleMLKit root stays 8.0.0 and any OCR regression has exactly
one suspect. Verified after `pod install`: `GoogleMLKit/* (8.0.0)`,
`MLKitVision (9.0.0)`, `VisionCamera (5.0.11)` all UNCHANGED;
`RNMLKitTextRecognition 2.0.0 → 5.0.1`; `RNMLKitCore (3.1.0)` added; all four
`MLKitTextRecognition{Chinese,Devanagari,Japanese,Korean}` pods removed.

**PR 2 (next) — VisionCamera 5.1.1 + MLKit 9**, plus the two REVERT ME holding
measures above and the iOS metering-workaround removal.

⚠️ **Correction to carry forward:** an unpinned dependency adds no constraint —
it does not force the maximum. `MLKitVision` stays at **9.0.0** in PR 1 (both
`MLKitTextRecognition 6.0.0` and `MLKitBarcodeScanning 7.0.0` declare `~> 9.0`)
and moves to 10.0.0 only in PR 2. Confirmed empirically against the regenerated
`Podfile.lock`.

**Two notes for PR 2's implementer:**

- npm nests `@infinitered/react-native-mlkit-core` under the text-recognition
  package rather than hoisting it. Expo autolinking discovers it fine (verified),
  but `ls node_modules/@infinitered/` will not show it.
- `npm install` emits `ERESOLVE overriding peer dependency` **warnings** (not
  errors) because `mlkit-core@3.1.0` ships Jest tooling as runtime
  `dependencies`, dragging in `react-test-renderer@17.0.2` against React 19. No
  `overrides` entry was needed: Infinite Red's shipped build has zero
  `@testing-library` imports, so Metro never bundles any of it. It is
  node_modules bloat, not app bloat — do not "fix" it speculatively.

### 2026-07-27 — PR 2 implemented: VisionCamera 5.1.1 + GoogleMLKit 9

Commit `8f30a5f0` on `feat/visioncamera-511-mlkit-9`. Criteria #2 and #3 closed.

**Branch is stacked on PR 1, not `main`.** The plan called for branching off
`main` after #728 merged, but that is not reachable: at `main` the old OCR
package still pins `GoogleMLKit/TextRecognition = 8.0.0`, so the bump reproduces
the exact conflict this todo exists to fix. The PR's base is
`feat/ocr-swap-infinitered-mlkit`; GitHub retargets it to `main` when #728
merges. Basing on `main` would also have shown PR 1's 454 additions in the diff.

**`pod install` refuses this bump — by design, and that is the safety property.**
`Podfile.lock` acts as a snapshot constraint, so it holds every pod at its locked
version and reports a conflict rather than silently crossing a native major. It
took an explicit `pod update GoogleMLKit MLKitVision MLKitBarcodeScanning
MLKitTextRecognition MLKitTextRecognitionCommon MLKitCommon`. (The same mechanism
is what kept the root at 8.0.0 throughout PR 1.) One `pod update GoogleMLKit`
alone is not enough — it cascades to a second conflict on `MLKitVision`, which is
snapshot-pinned at 9.0.0 while the new chain needs `~> 10.0`.

**Transitive drift beyond the plan's list**, all pulled by `MLKitCommon 14.0.0`:
`GoogleUtilities` 8.1.0→8.1.2, `MLImage` 1.0.0-beta7→beta8, `PromisesObjC`
2.4.0→2.4.1. `NitroImage` is now a declared pod dependency of
`VisionCameraBarcodeScanner 5.1.1` (matching its new npm peer dep; already
installed at 0.14.0). npm-side: `nitro-modules` 0.35.6 and `nitro-image` 0.14.0
did **not** move, as predicted. `project.pbxproj` is untouched this time.

**`post_install` verified by artifact, not by console silence.** `ios/Podfile:141-193`
is not rescue-wrapped, so a raise there would silently skip the VisionCamera
Swift-settings block at `:204-211` — and that block is what prevents the
Release-only LLVM optimizer crash. Confirmed: zero `EXCLUDED_ARCHS` left in any
xcconfig, `[MLKit] Patch for platform` phase intact, and **all four** VisionCamera
build configurations (both targets × Debug **and Release**) carrying
`SWIFT_COMPILATION_MODE=singlefile` / `-Onone` / `SWIFT_VERSION=5`. A local Debug
build is `-Onone` anyway, so it would have passed even if the hook had skipped —
which is exactly why the artifact check was necessary.

**Metering surgery: half out, half permanent.** See AC #7 above for the source
evidence. The `options = { modes }` construction is gone; the
`modes.length === 0` early return and `supportedMeteringModes()` both stay.

**Test correction — the plan was internally inconsistent here.** It asked for a
one-argument `focusTo({x,y})` call, an assertion of
`toHaveBeenCalledWith({x,y}, undefined)`, _and_ zero changes to the Android
block. Those cannot all hold: Vitest compares the whole arguments array, and the
Android cases already asserted arity 2 (they passed because `options` was
declared-but-unassigned on Android). Resolved toward the clean call site — one
argument, and **all four** assertions updated to match. Verified two-sided with a
temporary negative control: a 2-arg assertion does fail against the 1-arg call,
so these assertions genuinely guard a regression back to filtering rather than
passing vacuously. 22/22 green.

**Still blocking merge (device-only):** AC #4 OCR end-to-end, AC #5 barcode on
both platforms, AC #7 tap-to-focus on-device, AC #8 `useCameraDevice` lens
selection at barcode distance (~10–15 cm — 5.1.0's #4053 changed default camera
selection). A **Release-configuration** build is also required before merge; the
LLVM crash never manifests in local Debug.

### 2026-08-08 — reconciliation: #729 MERGED 2026-07-29; this file had gone stale

No work happened on this todo between 2026-07-28 and 2026-08-08, and the file
still described #729 as OPEN. It is not.

**#729 merged 2026-07-29T23:15Z as `ed8ec449`** (squash, by the repo owner), with
**three acceptance criteria still open** — #5-Android, #7, #8. Confirmed against
the GitHub API, not from context. Checked specifically for a merge-day device
pass that would have closed them: no todo edit, no `docs/solutions` commit, and
no justification in the squash body. So the merge was a judgment call to ship
with those three uncovered, and the residual is real rather than clerical.

**What is now live on `main`:** VisionCamera + `-barcode-scanner` 5.1.1, a single
`GoogleMLKit` root at 9.0.0, `MLKitVision` 10.0.0, and
`patches/react-native-vision-camera+5.1.1.patch`.

**The `enableJsiParser` patch is load-bearing and its upstream regression was
never reported.** `postinstall: patch-package` is wired and the patch verifies as
applied — both `nitrogen/generated/shared/c++/views/Hybrid{PreviewView,FrameRendererView}Component.cpp`
carry `RawPropsParser(/* enableJsiParser */ true)`. Since 5.2.0 carries the same
upstream bug, **any future VisionCamera bump must carry this patch forward** or
the camera aborts on mount again. Filing upstream remains unowned.

**Why this sat for eleven days is structural, not neglect.** The todo is
`human_led: true` and every open criterion needs a tethered phone or an emulator
with camera passthrough. No `/todo` executor, subagent, or worktree can close
#5, #7 or #8 — CI has no native build step and never loads MLKit at all.

**AC #5, first half — the Android BUILD: ✅ PASSES.** Until now every build on
this upgrade had been iOS, leaving `react-native-vision-camera-barcode-scanner`
5.1.1's **Android** Gradle dependency move unverified on shipped code. Run
2026-08-08, `./gradlew assembleDebug`:

```
BUILD SUCCESSFUL in 5m 18s
exit code:                                    0
"Could not resolve" / "Could not find":       0
react-native-vision-camera Gradle tasks:      104
app-debug.apk:                                306.2 MB
```

**The load-bearing evidence is not the exit code — it is that both MLKit
families coexist in one resolved graph**, which is exactly what CocoaPods
refused on iOS:

```
com.google.mlkit:barcode-scanning:17.3.0
com.google.mlkit:text-recognition:16.0.1
com.google.mlkit:common:18.6.0  -> 18.11.0
com.google.mlkit:common:18.9.0  -> 18.11.0
com.google.mlkit:vision-common:17.+ -> 17.3.0
```

Gradle reconciled three different `common` requests to one version by picking
the highest — no straddle, no conflict. This **empirically confirms** the
2026-07-27 claim that the 8↔9 conflict was iOS-only because Maven coordinates
carry no shared-root constraint; it had been reasoned from the podspec, never
built.

Packaging verified too, not just compilation — the decoder native libraries are
in the APK for **all four ABIs**: `libbarhopper_v3.so` (barcode) and
`libmlkit_google_ocr_pipeline.so` (text recognition) under `lib/{arm64-v8a,
armeabi-v7a,x86,x86_64}/`.

**What this does NOT close:** the app was never launched and no barcode was
scanned, so `useBarcodeScannerOutput` has still never executed. AC #5 stays
unticked. The emulator route is confirmed available (AVD
`Medium_Phone_API_36.1` present; `emulator -webcam-list` reports `webcam0` and
`webcam1`), so the scan half needs no physical Android hardware.

> ⚠️ **Partly SUPERSEDED the same day** — see the emulator-run entry at the end
> of this file. The app _was_ subsequently launched and **the camera mounts on
> Android**. What remains unproven is narrower than this paragraph states: only
> the barcode **decode** itself.

⚠️ **Scope limit — this is a proxy for `main`, not `main` itself.** The build ran
from a working tree at `fb1baf71` + JS-only probe commits, against `node_modules`
resolved from **that** lockfile, not `origin/main`'s (26 commits ahead). `android/`
is byte-identical between the two and the probe commits touch only `client/**`, so
the Android build graph is the same; the three intervening `package.json` changes
were npm **security overrides** (postcss et al.) with no Android native surface.
Sound, but it is inference — a build from a clean `origin/main` + `npm ci` is the
unqualified version.

🔎 **Finding worth a decision (not actioned):** the resolved graph contains a
**dynamic version** — `com.google.mlkit:vision-common:17.+ -> 17.3.0`, declared
upstream, not by us. It resolves fine today, but a floating range means the Android
build is **not reproducible**: an upstream `17.4.0` publish silently changes the
graph with no lockfile diff and no CI signal, since CI has no native build step.
Pinning it via a Gradle `resolutionStrategy` would close that; doing so is a call
for the repo owner.

### 2026-08-08 (emulator run) — the camera MOUNTS on Android; only the decode is left

Went past the build into a real emulator run on `Medium_Phone_API_36.1`
(Android 16, arm64-v8a), signed in as `demo`, and opened the scan screen.

**✅ The camera mounts and runs on Android under VisionCamera 5.1.1 + MLKit 9.**

| Evidence             |                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Camera session       | `ActiveCameraSessionSingle: Camera #CameraId-10 State changed! Type: OPEN \| Error: null` |
| Scan UI              | live preview + Barcode/Nutrition/Front selector + reticle + shutter                       |
| MLKit barcode module | `DynamiteModule: Selected local version of com.google.mlkit.dynamite.barcode`             |
| Runtime version      | `1.2.0` reported by the dev client — #729's bump is live on Android                       |
| Crashes              | **zero** `react_native_assert`, `SIGABRT`, or `ElfError`                                  |

That third row is the load-bearing one: it is the **bundled** MLKit barcode
module — what `com.google.mlkit:barcode-scanning:17.3.0` ships — loading
in-process at scan time, on top of an open camera session.

**⚠️ This RETIRES a prediction from the #729 thread.** That comment said of the
`enableJsiParser` regression: _"Expect Android to fail identically — the
regression is in `nitrogen/generated/**/shared/c++`, shared, not per-platform."_
**It does not fail.** `patches/react-native-vision-camera+5.1.1.patch` is applied
by `postinstall` and covers Android as well as iOS. Do not re-litigate this.

**⬜ AC #5 still unticked — only the decode remains.** No barcode was decoded, so
`useBarcodeScannerOutput` has still never produced a result. The blocker is
purely fixture framing: the emulator's virtual-scene camera faces the
bookshelf/TV wall, the injected poster is behind it, and the scene camera is
turned by dragging **inside the emulator window** — `adb` cannot drive it
(`adb emu physics` only records; the accelerometer does not steer it while an app
holds the camera). ~~A human drag of ~10 seconds closes this criterion.~~

> ⛔ **CORRECTED 2026-08-08 (second attempt): the human drag does NOT work
> either. Stop trying to close AC #5 on the emulator.** A second session booted
> with the poster on **both** `wall` and `table`, reached the live scan screen,
> and the scene camera could not be turned at all: **mouse drag did nothing and
> WASD did nothing.** The virtual-scene navigation controls are inert while the
> guest app holds the camera — so with the poster outside the default field of
> view there is no supported way, automated **or** manual, to bring it into
> frame. `adb emu virtualscene-image` only swaps the _texture_ on two fixed
> surfaces; it cannot move the camera, and only `wall` and `table` exist.
>
> Two emulator-environment defects also burned time and will recur: RN's
> **LogBox escalates the harmless `expo-notifications: Custom sound 'default'
not found` warning to a full-screen Console Error** that covers the app and
> **closes the camera session** (`Type: CLOSED`) — dismiss with
> `adb shell input tap <Dismiss>`; and **`com.google.android.tts` crashloops on
> this AVD** (`SIGILL`, 367 crash lines in one window), throwing "keeps
> stopping" system dialogs that swallow input — kill it with
> `adb shell pm disable-user --user 0 com.google.android.tts`.
>
> **The decode needs a real Android device**, or a different camera-injection
> route than virtualscene. Do not spend more time on the emulator for AC #5 —
> everything the emulator _can_ prove (build, install, launch, camera mount,
> MLKit barcode module load) is already proven and recorded above.

#### Reproduction recipe that works (use this, not the older text above)

- `-camera-back virtualscene -virtualscene-poster wall=<png>` — **not**
  `-camera-back webcam0`, which needs a person physically holding a barcode.
  `adb emu virtualscene-image <wall|table> <png>` sets it at runtime, no restart.
- **Generate the fixture and verify it independently** before trusting it. A bad
  fixture is indistinguishable from an MLKit failure. Used EAN-13
  `5449000000996` (Coca-Cola 330 mL, real OFF record), confirmed with macOS
  Vision `VNDetectBarcodesRequest` at 0.994 confidence.
- Build **one ABI**: `-PreactNativeArchitectures=arm64-v8a`. The 4-ABI APK is
  306 MB and dies with `INSTALL_FAILED_INSUFFICIENT_STORAGE`; arm64-only is
  ~104 MB. Apple Silicon emulators run arm64-v8a only.
- `adb reverse tcp:8081` for Metro; grant up front
  `pm grant … android.permission.CAMERA` **and**
  `appops set … SYSTEM_ALERT_WINDOW allow` — otherwise expo-dev-client opens the
  "Display over other apps" Settings page **on top of the app**, silently
  stealing UI-automation taps.
- Drive UI from `uiautomator dump`, never fixed coordinates: an inline error
  banner moves the Sign In button from y=1330 to y=1488.

#### Two defects found on the way — neither caused by this upgrade

1. **A network failure is displayed as "Incorrect username or password."**
   `client/screens/LoginScreen-utils.ts:135` (`getAuthErrorMessage`) maps every
   non-`RATE_LIMITED` error to that copy, so an unreachable backend is reported
   as wrong credentials. Confirmed empirically: `demo`/`demo123` returns **200**
   when POSTed directly, while the app showed the credential error and the server
   logged **zero** requests from the device. The static-copy rule it follows
   (`no-error-message-in-ui`, anti-enumeration) is correct and should stay —
   collapsing _unreachable_ into _wrong credentials_ is the separable bug. Costs
   real user trust on a flaky connection, and it burned significant debugging
   time here.
2. **A zero-filled native library passed every structural check.**
   `libreanimated.so` was 80 MB of `0x00`: correct size, 16 KB-aligned, stored
   uncompressed, and **`zipalign -c` verified successful** — but its ELF magic
   was `00000000`, not `7f454c46`. It crashed the app at
   `SoLoader → NativeReanimatedModule` with `MinElf$ElfError`. `stripDebugDebugSymbols`
   then reduced it to a 24-byte file and **exited 0 with no warning**. Origin: the
   first Android build ran with the host disk at 94%. `:react-native-reanimated:clean`
   produced a correct 7.6 MB stripped ELF.
   **Lesson: verify native-artifact CONTENT (ELF magic), not size — size,
   alignment and compression all looked right, and a mid-session "fix" that
   copied the 80 MB file over the 24-byte one propagated the corruption.**

#### Environment fix applied

`.env`'s `EXPO_PUBLIC_DOMAIN` was stale at `192.168.0.148:3000` while the Mac had
moved to `192.168.0.103`; corrected in place (backup `.env.bak`, both gitignored).
`192.168.0.103` is the right value rather than `localhost` — `localhost` works for
the Android emulator via `adb reverse` but breaks a physical iPhone, which needs
the LAN IP. This trap is exactly `reference_sim_dev_loop_gotchas`.
