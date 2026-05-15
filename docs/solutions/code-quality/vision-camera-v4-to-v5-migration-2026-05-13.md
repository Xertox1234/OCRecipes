---
title: "react-native-vision-camera v4→v5 + capture-then-OCR migration"
track: bug
category: code-quality
tags: [camera, visioncamera, ocr, migration, react-native, ios]
module: camera
applies_to: ["client/camera/**/*.ts", "client/camera/**/*.tsx", "ios/**"]
symptoms:
  - "useCodeScanner / photo={true} props no longer accepted after V5 upgrade"
  - "Swift 6.2 ICE on Xcode 26 when compiling nitrogen-generated barcode scanner Swift code"
  - "react-native-vision-camera-ocr-plus has no V5 peer-dep compatibility"
created: 2026-05-01
severity: high
---

# react-native-vision-camera v4→v5 + capture-then-OCR migration

## Problem

Migrated from `react-native-vision-camera` v4.7.3 to v5.0.8 (Nitro Modules rewrite). Simultaneously dropped `react-native-vision-camera-ocr-plus` (live frame-processor OCR) in favour of capture-then-OCR: take a still with V5's `capturePhotoToFile`, then run `@react-native-ml-kit/text-recognition` on the full-resolution image.

The OCR-plus plugin has no V5 peer-dep compatibility and no migration path. Full-resolution still OCR is more accurate than motion-blurred 10th-frame OCR anyway, and eliminates the frame-processor overhead (better battery, lower thermals).

## Symptoms

- `useCodeScanner` / `photo={true}` / `<Camera takePhoto>` no longer work
- iOS build fails on `react-native-vision-camera-barcode-scanner`'s nitrogen Swift bridge with internal compiler error on Xcode 26 / Swift 6.2
- Barcode rects use different coordinate spaces between iOS and Android

## Root Cause

V5 is a Nitro Modules rewrite. Photo capture moved to `usePhotoOutput()` → `photoOutput.capturePhotoToFile()`; the camera ref no longer has `takePhoto`. Outputs are passed as an array (`outputs={[photoOutput, ...]}`). The barcode-scanner plugin uses nitrogen-generated C++/Swift interop that crashes `swift-frontend` 6.2 with an ICE on iOS; only the AVFoundation-based `useObjectOutput` (iOS-only) avoids the bug.

## Solution

**Key V5 API changes:**

- Photo capture moves to `usePhotoOutput()` → `photoOutput.capturePhotoToFile()`
- Barcode scanning uses `react-native-vision-camera-barcode-scanner`'s `useBarcodeScannerOutput()` returning a `CameraOutput`
- `<Camera outputs={[photoOutput, barcodeScannerOutput]}>` replaces `photo={true}` and `useCodeScanner`
- `device` prop now accepts `"back"` | `"front"` directly — no `useCameraDevice()` needed
- Torch is imperative: `cameraRef.current?.controller?.setTorchMode("on" | "off")`
- `Rect` bounding boxes use `left/right/top/bottom`, not `x/y/width/height` — convert with `width = right - left`
- `useBarcodeScannerOutput` requires `onError` (not optional)
- `useCameraPermission()` returns `{ hasPermission: boolean, requestPermission }` — synthesise `canAskAgain` with a `hasRequestedRef`
- QR format renamed: `"qr"` → `"qr-code"` in `BarcodeFormat`

**MLKit simulator patch:** Podfile post-install hook (`scripts/patch-mlkit-simulator.py`) still required — both `react-native-vision-camera-barcode-scanner` and `@react-native-ml-kit/text-recognition` pull in MLKit fat binaries that need re-tagging for arm64 simulators. Never run `expo prebuild --clean` or it will wipe the Podfile patch.

**Swift 6.2 ICE workaround — platform split via Metro file extensions:**

- `CameraView.tsx` = Android (uses `useBarcodeScannerOutput` from the barcode scanner pod)
- `CameraView.ios.tsx` = iOS (uses `useObjectOutput` from VisionCamera core — AVFoundation metadata, no external pod needed)
- `react-native.config.js` at project root excludes `react-native-vision-camera-barcode-scanner` from iOS autolinking (`platforms: { ios: null }`), so CocoaPods never installs the crashing pod on iOS
- Pod is still autolinking normally on Android

`useObjectOutput` type differences vs barcode scanner:

- Uses `ScannedObjectType` strings: `'qr'` (not `'qr-code'`), `'code-128'`, `'ean-13'`, `'ean-8'`, `'code-39'`, `'code-93'`, `'upc-e'`, `'data-matrix'`
- `ScannedObject.boundingBox` uses `{ x, y, width, height }` (no conversion needed)
- Narrow `ScannedObject` to `ScannedCode` using `isScannedCode(obj)` to access `obj.value`
- `upc_a` maps to `'ean-13'` — AVFoundation always reports UPC-A barcodes as EAN-13 with a leading zero
- `useObjectOutput` is iOS-only and will throw on Android — only ever import it in `.ios.tsx` files

## Prevention

Pin the VisionCamera + barcode scanner peer dependency carefully. When upgrading, run iOS and Android builds in parallel before merging. Document any platform-split file conventions so future authors don't accidentally cross-import.

## Related Files

- `client/camera/CameraView.tsx`
- `client/camera/CameraView.ios.tsx`
- `react-native.config.js`
- `scripts/patch-mlkit-simulator.py`
- `ios/Podfile`

## See Also

- [VisionCamera V5 frame processor plugin](visioncamera-v5-frame-processor-runonjs-bridge-2026-05-13.md)
