import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  GestureDetector,
  useSimultaneousGestures,
} from "react-native-gesture-handler";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Camera,
  useCameraDevice,
  usePhotoOutput,
  type CameraRef as VisionCameraRef,
} from "react-native-vision-camera";
import {
  useBarcodeScannerOutput,
  type Barcode,
} from "react-native-vision-camera-barcode-scanner";
import {
  BARCODE_TYPE_MAP,
  BARCODE_TYPE_REVERSE_MAP,
  isVisionCameraBarcodeType,
  type VisionCameraBarcodeType,
} from "@shared/types/camera";
import { AbsoluteFill, Spacing } from "@/constants/theme";
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
  ExpoBarcodeType,
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

// CameraX start-up race: a control call (torch/focus/zoom) issued while the
// session is not yet active. Matched on class name or message text.
function isBenignCameraCancel(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  return /OperationCanceledException|Camera is not active/i.test(text);
}

/** Format for the scanner the barcode hook builds but CameraView never attaches.
 *  react-native-vision-camera-barcode-scanner 5.2.3 has no skip option and
 *  throws on an empty list; drop this if a later version handles either. */
const UNATTACHED_SCANNER_TYPES: ExpoBarcodeType[] = ["qr"];

function mapBarcodeTypes(
  expoTypes: ExpoBarcodeType[],
): VisionCameraBarcodeType[] {
  return expoTypes.map((type) => BARCODE_TYPE_MAP[type]);
}

function mapBarcodeToResult(barcode: Barcode): BarcodeResult | null {
  if (!isVisionCameraBarcodeType(barcode.format)) return null;
  const expoType = BARCODE_TYPE_REVERSE_MAP[barcode.format];
  if (!expoType) return null;
  return {
    data: barcode.rawValue ?? "",
    type: expoType,
    bounds: barcode.boundingBox
      ? {
          x: barcode.boundingBox.left,
          y: barcode.boundingBox.top,
          width: barcode.boundingBox.right - barcode.boundingBox.left,
          height: barcode.boundingBox.bottom - barcode.boundingBox.top,
        }
      : undefined,
  };
}

/**
 * Camera component using react-native-vision-camera V5.
 * Provides barcode scanning (via useBarcodeScannerOutput) and photo capture.
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
    const cameraCancelWarnedRef = useRef(false);
    const scannerErrorReportedRef = useRef(false);
    // Interruptions latch PER REASON, and each reported start gets exactly one
    // end report — same as CameraView.ios.tsx. CameraX only reports `unknown`
    // today, but a library version that forwards a real reason must not have
    // its first (routine) one hide a later, diagnostic one.
    const reportedInterruptionReasonsRef = useRef(new Set<string>());
    const awaitingInterruptionEndRef = useRef(false);

    const { reducedMotion } = useAccessibility();
    const { focusPoint, zoomLabel, tapGesture, pinchGesture } =
      useCameraFocusAndZoom({ cameraRef, device });
    const composedGesture = useSimultaneousGestures(tapGesture, pinchGesture);

    const photoOutput = usePhotoOutput({
      qualityPrioritization: mapQualityPrioritization(photoQuality),
      quality: photoQuality ?? 0.85,
    });

    const handleBarcodeScanned = useCallback(
      (barcodes: Barcode[]) => {
        if (!onBarcodeScanned || barcodes.length === 0) return;
        for (const barcode of barcodes) {
          const result = mapBarcodeToResult(barcode);
          if (result) {
            onBarcodeScanned(result);
            return;
          }
        }
      },
      [onBarcodeScanned],
    );

    // `barcodeTypes` is a fresh array from the caller every render even when its
    // contents are unchanged. useBarcodeScannerOutput's own useMemo keys on
    // `barcodeFormats` identity to decide whether to recreate the native
    // barcode-scanner output — key this on content, not identity, or every
    // ScanScreen re-render (i.e. every barcode frame processed) tears down and
    // rebuilds the native output.
    //
    // The hook builds the native ML Kit scanner during render even when the
    // output is left out of `outputs` below, and an empty format list throws
    // ("Target barcodeFormats cannot be empty!") — a Render Error for the whole
    // scan screen in label / front-label mode. Hand it a placeholder format
    // then; that scanner is never attached, so it never scans or calls back.
    const barcodeTypesKey = barcodeTypes.join(",");
    const barcodeFormats = useMemo(
      () =>
        mapBarcodeTypes(
          barcodeTypes.length > 0 ? barcodeTypes : UNATTACHED_SCANNER_TYPES,
        ),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on barcodeTypesKey (content), not the barcodeTypes array reference
      [barcodeTypesKey],
    );
    const barcodeScannerOutput = useBarcodeScannerOutput({
      barcodeFormats,
      onBarcodeScanned: handleBarcodeScanned,
      onError: (error) => {
        if (scannerErrorReportedRef.current) return;
        scannerErrorReportedRef.current = true;
        logger.error("[CameraView] Barcode scanner error", error);
      },
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
      barcodeTypes.length > 0
        ? [photoOutput, barcodeScannerOutput]
        : [photoOutput];

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
              // CameraX throws OperationCanceledException ("Camera is not
              // active") when a control call races session start — benign,
              // the camera runs. Warn only, and leave the error latch for a
              // real failure.
              if (isBenignCameraCancel(error)) {
                if (!cameraCancelWarnedRef.current) {
                  cameraCancelWarnedRef.current = true;
                  logger.warn("[CameraView] Camera control cancelled", error);
                }
                return;
              }
              if (cameraErrorReportedRef.current) return;
              cameraErrorReportedRef.current = true;
              logger.error("[CameraView] Camera error", error);
            }}
            onInterruptionStarted={(reason) => {
              // Backgrounding the app mid-scan is routine, not a failure.
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

// Kept for edge cases where the camera hardware is unavailable
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
    ...AbsoluteFill,
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
