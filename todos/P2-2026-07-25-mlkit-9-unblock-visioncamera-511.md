---
title: "Resolve the GoogleMLKit 8→9 conflict blocking the VisionCamera 5.1.1 upgrade"
status: backlog
priority: medium
created: 2026-07-25
updated: 2026-07-25
assignee:
labels: [camera, dependencies, ios, ocr, native-build]
github_issue:
---

# Resolve the GoogleMLKit 8→9 conflict blocking the VisionCamera 5.1.1 upgrade

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

- **The npm side is clean.** Both `react-native-vision-camera` and
  `-barcode-scanner` publish 5.1.1. Peer deps are all `*`; `react-native-nitro-modules`
  (0.35.6) and `react-native-nitro-image` (0.14.0) do **not** need to move.
  The blocker is entirely at the CocoaPods layer.
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

- [ ] A decision is recorded on which option below is taken, and why
- [ ] `pod install` completes with `GoogleMLKit` resolved to a single root version
- [ ] `react-native-vision-camera` + `-barcode-scanner` both at 5.1.1, with
      `ios/Podfile.lock` regenerated and committed
- [ ] OCR still works end-to-end: nutrition-label capture → `recognizeTextFromPhoto`
      → parsed macros (this is the app's core scan path — MLKit 9's
      TextRecognition API must be verified, not assumed compatible)
- [ ] Barcode scanning verified on **both** iOS and Android (iOS uses
      `useObjectOutput`, Android uses `useBarcodeScannerOutput` — different code paths)
- [ ] iOS 26 simulator build still works (see the MLKit fat-binary risk below)
- [ ] Tap-to-focus re-verified on a physical device; then **delete the
      `Platform.OS === "ios"` workaround branch** in
      `client/camera/hooks/useCameraFocusAndZoom.ts` and its
      `supportedMeteringModes()` helper, per the "delete when 5.1.1 lands" note
      in that file and in
      `docs/solutions/logic-errors/library-auto-capability-default-fails-whole-operation-2026-07-25.md`
- [ ] `useCameraDevice` device selection re-verified — 5.1.0 shipped
      "Better `useCameraDevice(...)` including default Cameras" (#4053), a
      behavioral change to which physical camera gets picked

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
- **Verification needs EAS Build, not OTA.** This is a native change; an OTA
  update cannot deliver or validate it. The local iOS build is blocked on
  fmt vs clang 21, but that is a _local_ toolchain problem — EAS Build runs its
  own image and can produce both a dev client and a preview build.
- Do **not** run `npm audit fix` while touching the lockfile — use `package.json`
  `overrides` per `project_dependabot_transitive_override_remediation`.

## Scope Contract

- **Mechanisms to use:** dependency version changes, a podspec patch via
  `patch-package`/`postinstall` **or** a library swap — whichever option is
  chosen and recorded. Removal of the now-obsolete iOS metering workaround.
- **Files in scope:** `package.json`, `package-lock.json`, `ios/Podfile.lock`,
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
