---
title: expo-image-manipulator resize with both width and height scales to exactly that box — every upload was squashed into a square; pass only the limiting side
track: bug
category: logic-errors
module: client
severity: high
tags: [client-state, camera, image-upload, expo-image-manipulator, compression, ocr, aspect-ratio]
symptoms: ["compressed photos are 1024x1024 regardless of the source shape", "label and receipt photos look stretched, OCR/vision accuracy drops", "small images upscaled to the max box"]
applies_to: [client/lib/image-compression.ts]
created: '2026-10-29'
---

# Resizing with both dimensions stretches the photo

## Problem

`compressImage` passed `{ resize: { width: maxWidth, height: maxHeight } }`, intending "fit inside". expo-image-manipulator treats both values as the exact output size, so every compressed upload — label, receipt, cook, avatar, cover, photo scan — was stretched to a square, and images smaller than the box were upscaled.

## Symptoms

- A 4:3 camera photo comes back 1024×1024.
- Vision/OCR reads distorted text.

## Root Cause

The library keeps the aspect ratio only when ONE dimension is given (`ImageManipulator.types.d.ts`: "If you specify only one value, the other will be calculated automatically"). Android's `ResizeTransformer.kt` sets the height from the option whenever it is present.

## Solution

Read the source size (`Image.getSize(uri)` from react-native), skip the resize when the image already fits, and otherwise pass only the limiting side: `src.width / maxW >= src.height / maxH ? { width: maxW } : { height: maxH }`. If the size can't be read, bound the width alone — the shape is still kept. Apply the same action to the quality-retry pass, and delete the first-pass file (callers only clean up the returned one).

## Prevention

- Assert in tests that the resize action has exactly one key.
- `manipulateAsync` is deprecated in favour of `ImageManipulator.manipulate(uri).resize(...).renderAsync()` — the one-key rule is the same there.

## Related Files

- `client/lib/image-compression.ts`
- `client/lib/__tests__/image-compression.test.ts`

## See Also

- `docs/solutions/design-patterns/compress-upload-cleanup-for-image-uploads-2026-05-13.md`
