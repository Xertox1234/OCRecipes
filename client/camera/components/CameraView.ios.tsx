import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Camera,
  useCameraDevice,
  usePhotoOutput,
  useObjectOutput,
  isScannedCode,
  type CameraRef as VisionCameraRef,
  type ScannedObject,
  type ScannedObjectType,
} from "react-native-vision-camera";
import type { ExpoBarcodeType } from "@shared/types/camera";
import { Spacing } from "@/constants/theme";
import { logger } from "@/lib/logger";
import { useCameraFocusAndZoom } from "../hooks/useCameraFocusAndZoom";
import { FocusRing } from "./FocusRing";
import { ZoomLabel } from "./ZoomLabel";
import type {
  CameraViewProps,
  CameraRef,
  PhotoOptions,
  PhotoResult,
  BarcodeResult,
} from "../types";

/**
 * Maps a 0-1 quality value to V5's qualityPrioritization option.
 */
function mapQualityPrioritization(
  quality: number | undefined,
): "speed" | "balanced" | "quality" {
  if (quality === undefined) return "balanced";
  if (quality > 0.7) return "quality";
  if (quality > 0.3) return "balanced";
  return "speed";
}

// Maps our ExpoBarcodeType strings to AVFoundation ScannedObjectType strings.
// upc_a is intentionally mapped to 'ean-13' — AVFoundation reports UPC-A barcodes
// as EAN-13 with a leading zero prepended.
const EXPO_TO_OBJECT_TYPE: Partial<Record<ExpoBarcodeType, ScannedObjectType>> =
  {
    ean13: "ean-13",
    ean8: "ean-8",
    upc_a: "ean-13",
    upc_e: "upc-e",
    code128: "code-128",
    code39: "code-39",
    code93: "code-93",
    datamatrix: "data-matrix",
    qr: "qr",
  };

// Reverse map: ScannedObjectType → ExpoBarcodeType.
// No entry for 'ean-13' → 'upc_a' because AVFoundation always reports it as 'ean-13'.
const OBJECT_TYPE_TO_EXPO: Partial<Record<ScannedObjectType, ExpoBarcodeType>> =
  {
    "ean-13": "ean13",
    "ean-8": "ean8",
    "upc-e": "upc_e",
    "code-128": "code128",
    "code-39": "code39",
    "code-93": "code93",
    "data-matrix": "datamatrix",
    qr: "qr",
  };

function mapBarcodeTypes(expoTypes: ExpoBarcodeType[]): ScannedObjectType[] {
  const seen = new Set<ScannedObjectType>();
  const result: ScannedObjectType[] = [];
  for (const expoType of expoTypes) {
    const objectType = EXPO_TO_OBJECT_TYPE[expoType];
    if (objectType && !seen.has(objectType)) {
      seen.add(objectType);
      result.push(objectType);
    }
  }
  return result;
}

function mapObjectToResult(obj: ScannedObject): BarcodeResult | null {
  if (!isScannedCode(obj)) return null;
  const expoType = OBJECT_TYPE_TO_EXPO[obj.type];
  if (!expoType) return null;
  return {
    data: obj.value ?? "",
    type: expoType,
    bounds: {
      x: obj.boundingBox.x,
      y: obj.boundingBox.y,
      width: obj.boundingBox.width,
      height: obj.boundingBox.height,
    },
  };
}

/**
 * iOS-specific CameraView using useObjectOutput (AVFoundation metadata objects).
 * Avoids the react-native-vision-camera-barcode-scanner pod which crashes
 * swift-frontend 6.2 (Xcode 26 beta) with an ICE on nitrogen-generated interop.
 */
export const CameraView = forwardRef<CameraRef, CameraViewProps>(
  (
    {
      barcodeTypes,
      onBarcodeScanned,
      enableTorch = false,
      facing = "back",
      isActive = true,
      photoQuality,
      style,
    },
    ref,
  ) => {
    const cameraRef = useRef<VisionCameraRef>(null);
    const device = useCameraDevice(facing);

    // Hard latch (no re-arm), one per failure class, once per mount — unlike
    // useCameraFocusAndZoom's re-arming latch, these are rare session-level
    // failures reported for release/OTA-build visibility
    // (js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md),
    // not a high-frequency gesture callback where re-arming matters.
    const captureFailureReportedRef = useRef(false);
    const cameraErrorReportedRef = useRef(false);
    // Interruptions latch PER REASON: iOS forwards every
    // AVCaptureSession interruption, and a shared latch would let the first
    // (often routine) reason hide a later, diagnostic one for the whole mount.
    const reportedInterruptionReasonsRef = useRef(new Set<string>());
    // True from a reported start until its end: each reported interruption
    // gets exactly one end report, and a background interruption arriving
    // mid-episode doesn't swallow it.
    const awaitingInterruptionEndRef = useRef(false);

    const { reducedMotion } = useAccessibility();
    const { focusPoint, zoomLabel, tapGesture, pinchGesture } =
      useCameraFocusAndZoom({ cameraRef, device });
    const composedGesture = Gesture.Simultaneous(tapGesture, pinchGesture);

    const photoOutput = usePhotoOutput({
      qualityPrioritization: mapQualityPrioritization(photoQuality),
      quality: photoQuality ?? 0.85,
    });

    const handleObjectsScanned = useCallback(
      (objects: ScannedObject[]) => {
        if (!onBarcodeScanned || objects.length === 0) return;
        for (const obj of objects) {
          const result = mapObjectToResult(obj);
          if (result) {
            onBarcodeScanned(result);
            return;
          }
        }
      },
      [onBarcodeScanned],
    );

    // `barcodeTypes` is a fresh array from the caller every render even when its
    // contents are unchanged. useObjectOutput's own useMemo keys on `types`
    // identity to decide whether to recreate the native CameraObjectOutput
    // (an AVCaptureSession reconfigure) — key this on content, not identity,
    // or every ScanScreen re-render (i.e. every barcode frame processed) tears
    // down and rebuilds the native output.
    const barcodeTypesKey = barcodeTypes.join(",");
    const objectTypes = useMemo(
      () => mapBarcodeTypes(barcodeTypes),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on barcodeTypesKey (content), not the barcodeTypes array reference
      [barcodeTypesKey],
    );
    const objectOutput = useObjectOutput({
      types: objectTypes,
      onObjectsScanned:
        barcodeTypes.length > 0 ? handleObjectsScanned : undefined,
    });

    useImperativeHandle(ref, () => ({
      takePicture: async (
        _options?: PhotoOptions,
      ): Promise<PhotoResult | null> => {
        try {
          const photoFile = await photoOutput.capturePhotoToFile(
            { flashMode: "off" },
            {},
          );
          return { uri: `file://${photoFile.filePath}` };
        } catch (error) {
          if (!captureFailureReportedRef.current) {
            captureFailureReportedRef.current = true;
            logger.error("[CameraView] takePicture failed", error);
          }
          return null;
        }
      },
    }));

    const outputs =
      barcodeTypes.length > 0 ? [photoOutput, objectOutput] : [photoOutput];

    // No usable camera for this position (e.g. iOS Simulator) — render the
    // fallback instead of letting VisionCamera throw "no back Cameras".
    if (!device) return <CameraUnavailable />;

    return (
      <GestureDetector gesture={composedGesture}>
        <View style={[StyleSheet.absoluteFill, style]}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isActive}
            outputs={outputs}
            // Declarative torch (v5) — the framework re-applies it when the
            // session restarts (isActive false→true), unlike an imperative
            // setTorchMode effect which left the hardware torch off on resume.
            // undefined skips the lib's torch updater entirely — setTorchMode
            // throws on torch-less devices and the lib doesn't catch it.
            torchMode={
              device.hasTorch ? (enableTorch ? "on" : "off") : undefined
            }
            onError={(error) => {
              if (cameraErrorReportedRef.current) return;
              cameraErrorReportedRef.current = true;
              logger.error("[CameraView] Camera error", error);
            }}
            onInterruptionStarted={(reason) => {
              // Backgrounding the app mid-scan fires this reason; it is
              // routine, not a failure, so it never reaches error tracking.
              if (reason === "video-device-not-available-in-background") return;
              const reported = reportedInterruptionReasonsRef.current;
              if (reported.has(reason)) return;
              reported.add(reason);
              awaitingInterruptionEndRef.current = true;
              logger.error(
                `[CameraView] Camera session interrupted (${reason})`,
              );
            }}
            onInterruptionEnded={() => {
              if (!awaitingInterruptionEndRef.current) return;
              awaitingInterruptionEndRef.current = false;
              logger.error("[CameraView] Camera session interruption ended");
            }}
          />
          <FocusRing point={focusPoint} reducedMotion={reducedMotion} />
          <ZoomLabel label={zoomLabel} />
        </View>
      </GestureDetector>
    );
  },
);

CameraView.displayName = "CameraView";

export function CameraUnavailable() {
  const { theme } = useTheme();
  return (
    <View
      style={[styles.unavailable, { backgroundColor: theme.backgroundDefault }]}
    >
      <Feather
        name="camera-off"
        size={48}
        color={theme.textSecondary}
        accessible={false}
      />
      <ThemedText type="h4" style={styles.unavailableTitle}>
        Camera unavailable
      </ThemedText>
      <ThemedText
        type="body"
        style={[styles.unavailableSubtitle, { color: theme.textSecondary }]}
      >
        Camera is not available on this device
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  unavailable: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing["3xl"],
  },
  unavailableTitle: {
    marginTop: Spacing.sm,
  },
  unavailableSubtitle: {
    textAlign: "center",
  },
});
