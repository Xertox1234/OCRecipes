import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
} from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
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
import { Spacing } from "@/constants/theme";
import { logger } from "@/lib/logger";
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

    const barcodeScannerOutput = useBarcodeScannerOutput({
      barcodeFormats: mapBarcodeTypes(barcodeTypes),
      onBarcodeScanned: handleBarcodeScanned,
      onError: (error) => {
        logger.warn("[CameraView] Barcode scanner error:", error.message);
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
        } catch {
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
      <Camera
        ref={cameraRef}
        style={[StyleSheet.absoluteFill, style]}
        device={device}
        isActive={isActive}
        outputs={outputs}
        // Declarative torch (v5) — the framework re-applies it when the
        // session restarts (isActive false→true), unlike an imperative
        // setTorchMode effect which left the hardware torch off on resume.
        // undefined skips the lib's torch updater entirely — setTorchMode
        // throws on torch-less devices and the lib doesn't catch it.
        torchMode={device.hasTorch ? (enableTorch ? "on" : "off") : undefined}
        onError={(error) => {
          logger.warn("[CameraView] Camera error:", error.message);
        }}
      />
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
