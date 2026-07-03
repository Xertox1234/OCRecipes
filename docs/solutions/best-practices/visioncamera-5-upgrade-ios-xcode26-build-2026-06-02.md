---
title: Upgrading to VisionCamera 5 (Nitro) and building for iOS on Xcode 26
track: knowledge
category: best-practices
module: client
tags: [ios, visioncamera, nitro, reanimated, worklets, expo, build, xcode26, ocr]
applies_to: [package.json, ios/Podfile.properties.json, ios/Podfile, client/camera/**]
created: '2026-06-02'
---

# Upgrading to VisionCamera 5 (Nitro) and building for iOS on Xcode 26

## When this applies

Bumping `react-native-vision-camera` or its plugins, or repairing a failing `npx expo run:ios` on this stack: **Expo SDK 54, React Native 0.81, New Architecture ON, Xcode 26**. The build fails with `xcodebuild error 65`, and the errors are **stacked** — each masks the next, so fixing one surfaces another. Fix in order; never assume the first error is the only one.

## Why

VisionCamera 5 is a NitroModules + Swift/C++-interop rewrite. Four distinct, pre-existing blockers had to be peeled to get a clean simulator build (2026-06-02, PR #340):

1. **ocr-plus on the wrong major.** `react-native-vision-camera-ocr-plus@1.2.4` is a VisionCamera **v4** plugin (removed `FrameProcessorPlugin` Swift API + `VisionCameraProxyHolder`). Under v5 it fails to compile — first as a C++ parse error (`NitroModules/JSIConverter.hpp` "unknown type name 'namespace'", `React-jsi/jsi.h` "'cassert' file not found" — a C++ header parsed as Objective-C), then `cannot find type 'FrameProcessorPlugin' in scope`. → upgrade to **`2.0.0`** (Nitro/v5-native). v2 preserved the JS API the app uses (`useTextRecognition` → `{ scanText }`, the `Text` type), so `client/camera/hooks/useOCRDetection.ts` needed **no** change.

2. **Family version drift → Swift compiler ICE.** `react-native-vision-camera`, `-barcode-scanner`, and `-worklets` publish from one monorepo (mrousavy) and **share generated Nitro C++/Swift specs**. Mismatched (core/barcode 5.0.8 vs worklets 5.0.11), `swift-frontend` crashes (IR-gen ICE) compiling barcode-scanner's nitrogen interop on Xcode 26. The Podfile `SWIFT_COMPILATION_MODE = singlefile` workaround does NOT fix it. → **pin all three at the same version** (5.0.11).

3. **Prebuilt React core won't link to the arm64 simulator.** RN 0.81 ships a prebuilt `React.framework` whose arm64 slice is device-tagged. The iOS-26 `EXCLUDED_ARCHS` deletion (the MLKit simulator workaround) forces arm64-simulator, so linking the device-tagged prebuilt fails: `ld: building for 'iOS-simulator', but linking in dylib built for 'iOS'`. → set **`"ios.buildReactNativeFromSource": "true"`** in `ios/Podfile.properties.json` (builds RN from source — no prebuilt framework). Same fat-binary class as the MLKit patch, but for React core.

4. **Reanimated/worklets version ceiling.** ocr-plus v2 needs `react-native-worklets >=0.8.0`. worklets `0.9.x` pairs only with `reanimated 4.4.0`, which requires **RN 0.83+** (→ Expo SDK 55+). The RN-0.81-compatible ceiling is **`reanimated ~4.3.1` + `worklets ~0.8.3`** (both peer `react-native: 0.81 - 0.85`). Departs from Expo SDK 54's blessed `reanimated ~4.1.1` / `worklets 0.5.1` but resolves and builds. `react-native-worklets` is now a direct dep (the app imports `runOnJS` from it).

## Examples

`package.json` — the working set on RN 0.81 / Expo 54:

```json
"react-native-vision-camera": "^5.0.11",
"react-native-vision-camera-barcode-scanner": "^5.0.11",
"react-native-vision-camera-worklets": "^5.0.11",
"react-native-vision-camera-ocr-plus": "^2.0.0",
"react-native-worklets": "~0.8.3",
"react-native-reanimated": "~4.3.1"
```

`ios/Podfile.properties.json` (gitignored — re-apply after any fresh prebuild/checkout):

```json
"ios.buildReactNativeFromSource": "true"
```

Then `cd ios && pod install` → `npx expo run:ios`. Confirm the **real** exit code — a backgrounded `expo run:ios … ; echo` reports the echo's `0` and masks a failure. The success markers in the log are `› Build Succeeded` + `0 error(s)` + `Installing on <device>`.

## Exceptions

- `ios/` (incl. `Podfile.properties.json`, `Podfile`) is **gitignored** — the build-from-source toggle and Podfile patches live only in the local checkout and are NOT in any PR. Re-apply after `expo prebuild`.
- Building RN from source makes the first build notably slower (caches after).
- This intentionally pins below latest (reanimated 4.4 / worklets 0.9); revisit only when moving to RN 0.83+ / Expo SDK 55+.

## Related Files

- `package.json` — the version set
- `ios/Podfile.properties.json` — `buildReactNativeFromSource` toggle (gitignored)
- `ios/Podfile` — MLKit `EXCLUDED_ARCHS` deletion + `singlefile` workarounds (gitignored)
- `client/camera/hooks/useOCRDetection.ts` — the ocr-plus consumer (unchanged by v2)
- `scripts/patch-mlkit-simulator.py` — the MLKit fat-binary re-tagger

## See Also

- [Reanimated 4.3 createAnimatedComponent cast](../code-quality/reanimated-43-createanimatedcomponent-cast-2026-06-02.md) — the TS fix this upgrade also required
- [iOS native asset sync for persistent ios/ directory](ios-native-asset-sync-persistent-ios-directory-2026-05-13.md) — related gitignored-`ios/` gotcha
- [Auditing dependencies in the Expo/Drizzle/Zod stack](auditing-dependencies-expo-drizzle-zod-stack-2026-05-23.md) — dependency-bump method
