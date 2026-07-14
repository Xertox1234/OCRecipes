import { useCallback, useEffect, useRef, useState } from "react";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import type { CameraDevice, CameraRef } from "react-native-vision-camera";
import { clampZoom } from "./useCameraFocusAndZoom-utils";

export interface FocusPoint {
  x: number;
  y: number;
  key: number;
}

interface UseCameraFocusAndZoomOptions {
  cameraRef: React.RefObject<CameraRef | null>;
  device: CameraDevice | undefined;
}

/**
 * Tap-to-focus + pinch-to-zoom for VisionCamera v5. Custom gestures (not
 * `enableNativeTapToFocusGesture`/`enableNativeZoomGesture`) so the focus
 * ring's timing can be tied to the actual `focusTo()` promise instead of the
 * native gesture's silent (no visual feedback) behavior.
 */
export function useCameraFocusAndZoom({
  cameraRef,
  device,
}: UseCameraFocusAndZoomOptions) {
  const zoom = useSharedValue(1);
  const zoomAtGestureStart = useSharedValue(1);
  const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);
  const focusKeyRef = useRef(0);
  const [zoomLabel, setZoomLabel] = useState<string | null>(null);
  const zoomLabelHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFocus = useCallback(
    (x: number, y: number) => {
      focusKeyRef.current += 1;
      setFocusPoint({ x, y, key: focusKeyRef.current });
      cameraRef.current?.focusTo({ x, y }).catch(() => {
        // Devices without focus metering support reject — the ring still
        // shows for feedback; the camera falls back to continuous AF.
      });
    },
    [cameraRef],
  );

  // Imperative controller.setZoom(), NOT the <Camera zoom={SharedValue}>
  // prop — that path (VisionCamera's own useZoomUpdater) requires the
  // separate `react-native-vision-camera-worklets` package, which this app
  // doesn't install (it's snapshot-only OCR, no frame processors). Passing
  // an animated zoom SharedValue as a prop throws inside Camera's own
  // effect ("react-native-vision-camera-worklets is not installed"),
  // silently killing the whole preview. Bridging via runOnJS on every pinch
  // update costs a JS-thread hop per frame but avoids that dependency.
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

  // Bridged from the pinch worklet on every update via runOnJS — shows a live
  // "1.8x" readout during the gesture, fades out ~600ms after it stops
  // changing. Re-arms the hide timer on each call rather than debouncing, so
  // the label stays visible for the whole gesture and only starts its
  // fade-out countdown once the fingers actually stop moving.
  const showZoomLabel = useCallback((value: number) => {
    setZoomLabel(`${value.toFixed(1)}x`);
    if (zoomLabelHideTimer.current) clearTimeout(zoomLabelHideTimer.current);
    zoomLabelHideTimer.current = setTimeout(() => {
      setZoomLabel(null);
    }, 600);
  }, []);

  useEffect(() => {
    return () => {
      if (zoomLabelHideTimer.current) clearTimeout(zoomLabelHideTimer.current);
    };
  }, []);

  const tapGesture = Gesture.Tap().onEnd((e) => {
    runOnJS(runFocus)(e.x, e.y);
  });

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
      runOnJS(setCameraZoom)(zoom.value);
      runOnJS(showZoomLabel)(zoom.value);
    });

  return { focusPoint, zoomLabel, tapGesture, pinchGesture };
}
