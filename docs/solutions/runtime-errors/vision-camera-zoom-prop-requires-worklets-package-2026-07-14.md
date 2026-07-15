---
title: "<Camera zoom={SharedValue}> prop throws and kills the whole preview without react-native-vision-camera-worklets"
track: bug
category: runtime-errors
module: camera
severity: critical
tags: [camera, visioncamera, worklets, zoom, react-native, ios, android]
symptoms: ['Camera preview renders solid black with all JS overlay UI intact', 'Sentry/console error "Cannot use Frame Processors - react-native-vision-camera-worklets is not installed!"', 'Pinch-to-zoom implemented with a Reanimated SharedValue passed as the zoom prop']
applies_to: [client/camera/**/*.ts, client/camera/**/*.tsx]
created: 2026-07-14
---

# `<Camera zoom={SharedValue}>` prop throws and kills the whole preview without react-native-vision-camera-worklets

## Problem

Pinch-to-zoom was implemented by driving a Reanimated `SharedValue<number>` and passing it straight to VisionCamera V5's `<Camera zoom={zoom}>` prop, expecting the library to animate the native zoom on the UI thread. Instead the entire camera preview rendered solid black — all JS-rendered overlay UI (shutter, focus ring, zoom label) stayed intact, only the native feed died.

## Symptoms

- Scan screen shows a solid black rectangle where the camera feed should be; overlay UI renders normally
- Sentry/console reports: `Cannot use Frame Processors - react-native-vision-camera-worklets is not installed!`
- The crash only appears once a `zoom` prop backed by a `SharedValue` is added to `<Camera>` — a plain numeric `zoom` prop, or no zoom prop at all, does not trigger it

## Root Cause

Passing an animated `SharedValue<number>` as `<Camera zoom={...}>`'s prop routes through VisionCamera's own `useZoomUpdater` internal hook, which calls `VisionCameraWorkletsProxy.bindUIUpdatesToController(...)` to bind the shared value on the UI thread. That proxy lazily `require()`s the separate **`react-native-vision-camera-worklets`** package — a different package from `react-native-worklets` / `react-native-worklets-core` (see [VisionCamera V5 frame processor plugin](../code-quality/visioncamera-v5-frame-processor-runonjs-bridge-2026-05-13.md), which covers those two). This app deliberately does not install `react-native-vision-camera-worklets` — OCR is snapshot-only (capture-then-recognize), there are no frame processors, so the dependency was never added. The `require()` throws inside `Camera`'s own effect, which silently kills the whole preview instead of surfacing as an obvious crash screen.

Traced by reading VisionCamera's actual source: `src/views/Camera.tsx` → `src/hooks/internal/useZoomUpdater.ts` → `src/third-party/VisionCameraWorkletsProxy.ts`. Confirmed empirically via a production Sentry report showing the exact predicted error string after the fix shipped and was retested on-device.

## Solution

Drive zoom **imperatively** via the camera controller instead of passing an animated value as a prop — this path (`controller.setZoom()`) is a plain `Promise<void>` with no worklets dependency:

```typescript
const setCameraZoom = useCallback(
  (value: number) => {
    cameraRef.current?.controller?.setZoom(value).catch(() => {
      // Camera not ready yet / setZoom rejected — next gesture update
      // (or the label, which already reflects the intended value) is the
      // recovery; nothing user-facing to surface here.
    });
  },
  [cameraRef],
);

const pinchGesture = Gesture.Pinch()
  .onStart(() => {
    zoomAtGestureStart.value = zoom.value;
  })
  .onUpdate((e) => {
    if (!device) return;
    zoom.value = clampZoom(
      zoomAtGestureStart.value * e.scale,
      device.minZoom,
      device.maxZoom,
    );
    runOnJS(setCameraZoom)(zoom.value); // bridge JS-thread hop, not a worklet binding
    runOnJS(showZoomLabel)(zoom.value);
  });
```

Remove `zoom` from `<Camera>`'s props entirely — do not pass the `SharedValue` (or any derived plain number) as `zoom=`. Bridging via `runOnJS` on every pinch update costs a JS-thread hop per frame, but that's cheap relative to keeping the preview alive at all.

## Prevention

Before passing any `SharedValue` directly into a `<Camera>` prop (zoom, or any future animated prop VisionCamera exposes), check whether that prop's internal updater requires `react-native-vision-camera-worklets`. If the app is snapshot-only (no frame processors), assume that package is absent and prefer the imperative `controller.*()` API — it has no such dependency for any of `setZoom`, `setTorchMode`, or `focusTo`. Add a smoke check (manual or automated) that opens the scan screen after any camera-prop change — this failure mode renders no error UI, so it is silent without one.

## Related Files

- `client/camera/hooks/useCameraFocusAndZoom.ts`
- `client/camera/components/CameraView.tsx`
- `client/camera/components/CameraView.ios.tsx`

## See Also

- [VisionCamera V5 frame processor plugin + runOnJS bridge](../code-quality/visioncamera-v5-frame-processor-runonjs-bridge-2026-05-13.md) — a different worklets package (`react-native-worklets`), superseded/removed; kept as historical reference
- [react-native-vision-camera v4→v5 + capture-then-OCR migration](../code-quality/vision-camera-v4-to-v5-migration-2026-05-13.md) — the broader V5 migration this zoom code was built during
