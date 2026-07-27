import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue, runOnJS } from "react-native-reanimated";
import type { CameraDevice, CameraRef } from "react-native-vision-camera";
import { logger } from "@/lib/logger";
import {
  clampZoom,
  supportedMeteringModes,
} from "./useCameraFocusAndZoom-utils";

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
  const focusFailureReportedRef = useRef(false);
  const zoomFailureReportedRef = useRef(false);
  const [zoomLabel, setZoomLabel] = useState<string | null>(null);
  const zoomLabelHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFocus = useCallback(
    (x: number, y: number) => {
      // No device means no camera to focus — showing the ring here would
      // promise feedback for an action that cannot happen.
      if (!device) return;

      focusKeyRef.current += 1;
      setFocusPoint({ x, y, key: focusKeyRef.current });

      // iOS ONLY — and deliberately NOT the old 5.0.11 workaround. That one
      // passed an explicit `modes` array because getAllSupportedMeteringModes()
      // appended .awb UNCONDITIONALLY, so on a device without white-balance
      // metering the request failed the whole 3A operation, AF included.
      // VisionCamera 5.1.1 fixes exactly that (upstream #3976): .awb is now
      // gated on isWhiteBalanceModeSupported(), making the NATIVE default set
      // correct — so we pass no modes at all and let it compute them.
      //
      // What survives is the EMPTY-SET guard, which #3976 does not address.
      // HybridCameraController.swift resolves `options.modes ??
      // getAllSupportedMeteringModes()` FIRST and only then applies
      // `guard !modes.isEmpty`, so passing nothing does NOT bypass the
      // "MeteringModes cannot be empty!" throw. Without this early return a
      // device supporting no metering earns a guaranteed rejection — plus a
      // Sentry event — on its very first tap. The ring still shows for
      // feedback; the camera stays on continuous AF.
      //
      // The check is a deliberately conservative heuristic, NOT a mirror of the
      // native set, and cannot be made exact: supportsExposureMetering /
      // supportsFocusMetering are derived from is{Exposure,Focus}ModeSupported(),
      // while getAllSupportedMeteringModes() reads
      // is{Exposure,Focus}PointOfInterestSupported() — and VisionCamera exposes
      // no point-of-interest flag to JS. Only AWB agrees exactly. The residual
      // case (we allow, native throws) costs one latched log below.
      //
      // Android is NOT affected and must NOT get this guard: its CameraX path
      // derives modes from isFocusMeteringSupported() for the ACTUAL tapped
      // point, which is strictly better than our point-agnostic device flags.
      if (
        Platform.OS === "ios" &&
        supportedMeteringModes(device).length === 0
      ) {
        return;
      }

      cameraRef.current
        ?.focusTo({ x, y })
        .then(() => {
          // Re-arm. The latch below caps Sentry volume, but left permanently
          // set a transient early-tap rejection ("Camera is not yet ready!")
          // would consume the mount's only report and hide a later persistent
          // failure — the one actually worth knowing about.
          focusFailureReportedRef.current = false;
        })
        .catch((error: unknown) => {
          // Latched: this runs from a tap handler and logger.error forwards to
          // Sentry in production — unlatched, a user tapping a broken-focus
          // camera would emit one event per tap.
          if (focusFailureReportedRef.current) return;
          focusFailureReportedRef.current = true;
          logger.error(
            `[useCameraFocusAndZoom] focusTo failed (native default modes; ` +
              `device supports AE=${device.supportsExposureMetering} ` +
              `AF=${device.supportsFocusMetering} ` +
              `AWB=${device.supportsWhiteBalanceMetering})`,
            error,
          );
        });
    },
    [cameraRef, device],
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
      cameraRef.current?.controller
        ?.setZoom(value)
        .then(() => {
          // Re-arm, mirroring runFocus above: a transient early rejection
          // must not permanently suppress reporting for a later persistent
          // one.
          zoomFailureReportedRef.current = false;
        })
        .catch((error: unknown) => {
          // Latched: setZoom is invoked via runOnJS on EVERY pinch-gesture
          // frame (not once per tap, like runFocus's focusTo) — unlatched,
          // one dragged pinch on a broken zoom would emit dozens of Sentry
          // events. NOTE: the bound is "one report per success→failure
          // transition", not "one report per mount" — the .then() re-arm
          // above means an INTERMITTENTLY failing setZoom during one drag
          // can still emit more than one report; that's the same tradeoff
          // runFocus already accepts, just at a much higher call rate here.
          if (zoomFailureReportedRef.current) return;
          zoomFailureReportedRef.current = true;
          logger.error(
            `[useCameraFocusAndZoom] setZoom(${value.toFixed(1)}) failed (device zoom range ${device?.minZoom ?? "?"}-${device?.maxZoom ?? "?"})`,
            error,
          );
        });
    },
    [cameraRef, device],
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
