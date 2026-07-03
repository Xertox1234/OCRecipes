---
title: 'iOS build: vision-camera-ocr-plus needs Swift↔C++ interop under vision-camera v5 (NitroModules)'
track: bug
category: code-quality
module: camera
severity: high
tags: [camera, visioncamera, ocr, nitro, ios, build, cocoapods, swift-cxx-interop]
symptoms: [xcodebuild error 65 with 'could not build Objective-C module NitroImage', 'JSIConverter.hpp: unknown type name ''namespace'' / jsi.h: ''cassert'' file not found', SwiftCompile RemoveLanguageModel.swift fails in target RNVisionCameraOCR]
applies_to: [ios/Podfile, ios/**, client/camera/**]
created: '2026-06-02'
---

# iOS build: vision-camera-ocr-plus needs Swift↔C++ interop under vision-camera v5

## FINAL RESOLUTION (2026-06-03): the package was removed

The whole problem below was self-inflicted by keeping `react-native-vision-camera-ocr-plus`
(live frame-processor OCR) when the v4→v5 migration had already decided to drop it. The v2
upgrade + Podfile interop patches were stop-gaps. **The durable fix was to finish the migration
and delete the package entirely:**

- Label mode now uses **snapshot OCR** (`recognizeTextFromPhoto` → `@react-native-ml-kit/text-recognition`
  on the captured still) for its instant preview — the same path receipts/multi-step capture already
  used. The authoritative analysis was always server-side (`/api/photos/analyze-label`), so live OCR
  was UX-only.
- The Android-only **"text-detected" corner glow** (driven by the frame processor) was removed; the
  reticle stays. iOS never had the live path (`CameraView.ios.tsx` had no `useOCRDetection`), so iOS
  behavior is unchanged except it *gains* the snapshot preview.
- Deleted: `useOCRDetection.ts` + `useOCRDetection-utils.ts` + test; the `enableOCR`/`onTextDetected`/
  `onOCRResult`/`getLatestOCRResult` surface; and the npm packages `react-native-vision-camera-ocr-plus`
  **and** the now-orphaned `react-native-vision-camera-worklets`.
- **Result:** the `NitroVisionCameraOcrPlus`/`RNVisionCameraOCR` native pod — the source of the
  Swift↔C++ interop build break — is no longer in the build graph. `tsc` clean, 93 camera tests pass,
  arm64 simulator build SUCCEEDED (0 errors, app linked, MLKit + Sentry phases intact). The Podfile
  `objcxx` patch from the interim fix was already removed when ocr-plus went to v2; nothing references
  the old `RNVisionCameraOCR` target now.

**Lesson:** when a dependency is documented as "to be dropped," finishing the removal beats nursing it
through native-build fragility. The sections below are retained as the diagnosis record (and the v1
workaround, should anyone ever need ocr-plus again).

## Problem

`npx expo run:ios` fails with `xcodebuild` exit 65. Expo's log-parser surfaces a misleading
"first error" pointing at React-Native's JSI / NitroModules **C++ headers**, making it look
like a core RN/Nitro version skew. It is not — the *failing build command* is a **Swift** file
in a third-party pod.

## Symptoms

- Expo summary blames `NitroModules/JSIConverter.hpp` (`unknown type name 'namespace'`) and
  `React-jsi/jsi/jsi.h` (`'cassert' file not found`) → `could not build Objective-C module 'NitroImage'`.
- The **real** failing command (raw `xcodebuild` log, not the Expo summary):
  `SwiftCompile … RemoveLanguageModel.swift (in target 'RNVisionCameraOCR')`.
- Sentry / other pods compile clean — failure is unrelated to them.

## Root Cause

`react-native-vision-camera-ocr-plus` (pod `RNVisionCameraOCR`) is an **older, non-Nitro**
plugin written for vision-camera **v4**. After the v4→v5 migration, v5's headers transitively
pull Nitro's C++ modules into the OCR Swift target:

```
RNVisionCameraOCR (Swift, depends on VisionCamera v5)
  → imports NitroImage Clang module
    → NitroImage-umbrella.h → Color.hpp
      → #include <NitroModules/JSIConverter.hpp>   // namespace margelo::nitro { … }
        → #include <jsi/jsi.h> → #include <cassert>
```

The OCR target compiled Swift with `-enable-objc-interop` but **no** `-cxx-interoperability-mode`
(it had no `SWIFT_OBJC_INTEROP_MODE`). So Clang built the `NitroImage` module as **plain
Objective-C** — where `namespace` is illegal and the C++ stdlib (`<cassert>`) is off the include
path. The Nitro-native targets (`NitroImage`, `NitroModules`, `VisionCameraBarcodeScanner`) all
carry `SWIFT_OBJC_INTEROP_MODE = objcxx` via their own podspecs (nitrogen injects it); the
non-Nitro `RNVisionCameraOCR` did not, so it became the one target that builds the Nitro module
in the wrong language mode.

**Not** caused by: the 2026-06-02 Sentry/Expo pod bump; a Nitro version skew; or a stale Pods
graph. **Not fixable by** removing `react-native-nitro-image` (a transitive dep of
vision-camera v5) or `react-native-vision-camera-ocr-plus` (still live-used by `useOCRDetection`
for frame OCR — only *snapshot* OCR moved to `@react-native-ml-kit/text-recognition`).

## Resolution (chosen path — supersedes the Podfile patch below)

The durable fix is to **upgrade `react-native-vision-camera-ocr-plus` v1.2.4 → v2.0.0**, which is a
**Nitro-native rewrite** (pod renamed `RNVisionCameraOCR` → `NitroVisionCameraOcrPlus`). v2 is
built for vision-camera v5's Nitro architecture, so its podspec sets `SWIFT_OBJC_INTEROP_MODE = objcxx`
itself — eliminating the need for the manual Podfile patch. The v2 upgrade also pairs with
`react-native-vision-camera-worklets` and reanimated `~4.3.1` (done together on branch
`fix/vision-camera-ocr-plus-v5`). When on v2, remove the obsolete `RNVisionCameraOCR` `post_install`
block (it targets a target that no longer exists — harmless no-op, but dead config).

> **Verified 2026-06-02.** Despite being a major version bump, v2 is a **drop-in** for this app's
> usage: it still exports `useTextRecognition` (returning `{ scanText }`) and the `Text` type
> (`{ resultText, blocks }`). The app only reads `Text.resultText`, so no functional code change was
> needed — only a stale "V4-typed" comment in `useOCRDetection.ts` was corrected. `tsc --noEmit`
> passes clean, and a fresh-DerivedData **arm64 simulator build SUCCEEDED** (`OCRecipes.app` linked,
> 0 errors; MLKit patch + Sentry phases intact). New peer deps required and installed:
> `react-native-vision-camera-worklets` and `react-native-worklets`. **Not yet exercised:** runtime
> OCR (v2's `scanText` worklet calling the Nitro `recognizer.scanFrame` from `useFrameOutput`) — only
> provable by running the app against live text.

## Solution (workaround for v1.2.4 — kept for the diagnosis and as a fallback)

If staying on v1.2.4, add a per-target `post_install` hook in `ios/Podfile` (mirrors the existing
`VisionCameraBarcodeScanner` ICE-guard block) that gives `RNVisionCameraOCR` the C++ interop it
needs, on **all** build configs:

```ruby
installer.pods_project.targets.each do |target|
  next unless target.name == 'RNVisionCameraOCR'
  target.build_configurations.each do |config|
    config.build_settings['SWIFT_OBJC_INTEROP_MODE'] = 'objcxx'        # module builds as Obj-C++
    config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'     # match the Nitro pods
    config.build_settings['SWIFT_COMPILATION_MODE'] = 'singlefile'     # pre-empt Swift 6.2 ICE
    config.build_settings['SWIFT_VERSION'] = '5'
  end
end
```

Then `pod install`. After the fix, the OCR target's Clang args carry `-std=c++20 -stdlib=libc++`
and the module compiles as Objective-C++.

> `ios/Podfile` is gitignored (manual native customizations: MLKit simulator patch, etc.). This
> hook must be re-applied if `ios/` is ever regenerated — hence this doc. Do **not** run
> `expo prebuild --clean` (wipes the customizations).

## Prevention

- When a **non-Nitro** Swift pod depends on a Nitro-based pod (vision-camera v5 and friends),
  it must compile with `SWIFT_OBJC_INTEROP_MODE = objcxx` + `CLANG_CXX_LANGUAGE_STANDARD = c++20`.
- When an iOS build "fails on a C++ header," read the **raw** `xcodebuild` log for the actual
  failing *command/target*, not Expo's formatted "N errors" summary — the surfaced header is
  often a downstream module-build symptom of a different Swift target.

## Known Limitation (out of scope of this fix)

The `VisionCameraBarcodeScanner` Swift 6.2 ICE workaround (`SWIFT_COMPILATION_MODE = singlefile`)
holds for **arm64** but still ICEs on the **x86_64** simulator slice. Local Apple-Silicon dev
(`npx expo run:ios`, arm64-only) is unaffected; an Intel-simulator or universal build would hit
it. Pre-existing, independent of this OCR fix.

## Related Files

- `ios/Podfile` (`post_install`) — the fix
- `client/camera/hooks/useOCRDetection.ts` — live consumer of `react-native-vision-camera-ocr-plus`
- `node_modules/react-native-vision-camera-ocr-plus/ios/RemoveLanguageModel.swift` — the file in the failing command

## See Also

- `docs/solutions/code-quality/vision-camera-v4-to-v5-migration-2026-05-13.md` — the v4→v5 migration that introduced the Nitro dependency chain
