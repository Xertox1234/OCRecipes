---
title: "useBarcodeScannerOutput with an empty format list throws on Android during render — pass a placeholder format when the scanner is not attached"
track: bug
category: runtime-errors
tags: [react-native, camera]
module: camera
applies_to: ["client/camera/**/*.tsx", "client/screens/ScanScreen.tsx"]
symptoms: ["Render Error \"Target barcodeFormats cannot be empty!\" on Android", "Scan a Label and the label steps after a barcode scan show the red error screen", "iOS is fine"]
created: 2026-10-29
severity: high
---

# useBarcodeScannerOutput with an empty format list throws on Android during render — pass a placeholder format when the scanner is not attached

## Problem

In label and front-label mode `ScanScreen` passes `barcodeTypes=[]`. `CameraView` correctly left the barcode output out of `outputs`, but it still called `useBarcodeScannerOutput({ barcodeFormats: [] })`. That hook builds the native ML Kit scanner during render, whether or not the output is ever attached. On Android an empty format list throws `Target barcodeFormats cannot be empty!`, which takes down the whole scan screen.

## Symptoms

- `ocrecipes://scan?mode=label` showed a Render Error on an Android 16 phone. Barcode mode was fine.
- iOS was never affected, because it renders `CameraView.ios.tsx`.

## Root Cause

A hook can't be skipped conditionally, so "not using the barcode output" still constructs it. The Android native code validates its arguments at construction, and an empty list fails that check.

## Solution

When there are no barcode types, give the hook a placeholder format (`UNATTACHED_SCANNER_TYPES = ["qr"]`). That scanner is never put into `outputs`, so it never scans or calls back. Keep the memo keyed on the content of the types, not the array reference, so a re-render doesn't rebuild the native output.

```ts
const barcodeFormats = useMemo(
  () => mapBarcodeTypes(barcodeTypes.length > 0 ? barcodeTypes : UNATTACHED_SCANNER_TYPES),
  [barcodeTypesKey],
);
```

## Prevention

- When a native-backed hook must run unconditionally, check what it does with "empty" input on **both** platforms. Leaving the output out of `outputs` doesn't stop the hook from constructing it.
- Platform files (`.ios.tsx`) mean an iOS run says nothing about the shared Android file. Open the screen in every mode on an Android device.

## Related Files

- `client/camera/components/CameraView.tsx` (`UNATTACHED_SCANNER_TYPES`), `client/camera/components/__tests__/CameraView.test.tsx`
- `client/screens/ScanScreen.tsx`

## See Also

- [VisionCamera v5 output identity and callback staleness](../logic-errors/visioncamera-v5-output-identity-and-callback-staleness-2026-07-17.md) — why the formats memo is keyed on content
