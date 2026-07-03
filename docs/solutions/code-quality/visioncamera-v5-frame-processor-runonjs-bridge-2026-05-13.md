---
title: VisionCamera V5 frame processor plugin + runOnJS bridge
track: bug
category: code-quality
module: camera
severity: medium
tags: [camera, visioncamera, worklets, react-native, frame-processor]
symptoms: [useFrameProcessor() no longer exists after V5 upgrade, Third-party OCR plugin types don't match V5's Frame export, Frame pipeline stalls when frames are not disposed]
applies_to: [client/camera/**/*.ts, client/camera/**/*.tsx]
created: '2026-05-03'
---

# VisionCamera V5 frame processor plugin + runOnJS bridge

> **Superseded (2026-06-03): this technique is no longer used in the app.** Its only consumer was
> label-mode live OCR via `react-native-vision-camera-ocr-plus`, removed entirely on 2026-06-03
> (label OCR now runs on the captured still via `recognizeTextFromPhoto`). No `useFrameOutput`
> frame-processor worklet remains in the app. Kept as a historical reference for the V5
> `useFrameProcessor`→`useFrameOutput` + runOnJS bridge pattern, should a frame processor ever be
> reintroduced. See `vision-camera-ocr-plus-v5-cpp-interop-2026-06-02.md` → "FINAL RESOLUTION".

## Problem

VisionCamera V5 replaces `useFrameProcessor()` (V4) with `useFrameOutput()`. Third-party plugins like `react-native-vision-camera-ocr-plus` still expose worklet functions via `VisionCameraProxy.initFrameProcessorPlugin` — these work fine in V5, but the library's `Camera` component (which uses `useFrameProcessor` internally) does not.

## Symptoms

- Frame pipeline stalls or drops frames after upgrading to V5
- OCR library types `Frame` against V4 spec; TypeScript errors on `scanText(frame)`
- `runOnJS` from `react-native-worklets-core` no longer bridges correctly
- Combining `frameSkipThreshold` with a manual counter produces ~0.3fps throughput

## Root Cause

V5 rewrites the camera as Nitro Modules. `useFrameProcessor` was removed; outputs are now `CameraOutput` objects added to the `outputs={[...]}` prop. Frames must be explicitly disposed. The worklets bridge moved from `react-native-worklets-core` to `react-native-worklets`.

## Solution

Pattern for V5 + third-party frame processor plugin:

```typescript
import { useFrameOutput } from "react-native-vision-camera";
import { useTextRecognition } from "react-native-vision-camera-ocr-plus";
import { runOnJS } from "react-native-worklets";

const { scanText } = useTextRecognition({ language: "latin" });
// Note: do NOT set frameSkipThreshold here — the manual frame counter in onFrame
// already skips every 10th frame. Setting both multiplies them (100× skip, ~0.3fps).

// Wrap the JS callback in a stable runOnJS bridge (via useMemo to avoid recreation)
const handleResultJS = useMemo(() => runOnJS(handleResult), [handleResult]);

const frameCountRef = useRef({ value: 0 }); // object so worklet can mutate .value

const frameOutput = useFrameOutput({
  onFrame: useCallback(
    (frame) => {
      "worklet";
      frameCountRef.current.value = (frameCountRef.current.value + 1) % 10;
      if (frameCountRef.current.value !== 0) {
        frame.dispose();
        return;
      }
      // Cast: OCR library types Frame against V4; underlying Nitro object is identical
      const result = scanText(frame as Parameters<typeof scanText>[0]);
      frame.dispose(); // must dispose explicitly in V5
      handleResultJS(result);
    },
    [scanText, handleResultJS],
  ),
});
// Add frameOutput to Camera's outputs array alongside photoOutput
```

**Key differences from V4:**

- `frame.dispose()` is mandatory — undisposed frames stall the pipeline
- `runOnJS` from `react-native-worklets` (not `react-native-worklets-core`) bridges to JS thread
- `useMemo(() => runOnJS(fn), [fn])` stabilizes the bridge across renders
- `useFrameOutput` returns a `CameraFrameOutput` added to `outputs={[photoOutput, frameOutput]}`
- Do not combine `frameSkipThreshold` with a manual frame counter — the skips multiply

The cast (`frame as Parameters<typeof scanText>[0]`) keeps type checking on surrounding code while satisfying the library's V4-typed parameter — not `as any`.

## Prevention

When integrating any third-party VisionCamera plugin in V5, verify the plugin exposes its worklet via `VisionCameraProxy.initFrameProcessorPlugin` and stick with the per-frame counter pattern. Add a regression test or in-app frame counter to detect pipeline stalls early.

## Related Files

- `client/camera/CameraView.tsx`
- `client/camera/hooks/useCamera.ts`
- `docs/legacy-patterns/react-native.md` — VisionCamera V5 patterns
