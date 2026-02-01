import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
} from "react";
import { StyleSheet, View, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
  type Code,
} from "react-native-vision-camera";
import {
  BARCODE_TYPE_MAP,
  BARCODE_TYPE_REVERSE_MAP,
  isVisionCameraBarcodeType,
} from "@shared/types/camera";
import { Spacing } from "@/constants/theme";
import type {
  CameraViewProps,
  CameraRef,
  PhotoOptions,
  PhotoResult,
  BarcodeResult,
  ExpoBarcodeType,
} from "../types";

/**
 * Maps a 0-1 quality value to vision-camera's qualityPrioritization format.
 * - quality > 0.7 -> "quality" (prioritizes image quality)
 * - quality > 0.3 -> "balanced" (balanced speed/quality)
 * - otherwise -> "speed" (prioritizes capture speed)
 * - If undefined, defaults to "balanced"
 */
function mapQualityToPhotoQualityBalance(
  quality: number | undefined,
): "speed" | "balanced" | "quality" {
  if (quality === undefined) {
    return "balanced";
  }
  if (quality > 0.7) {
    return "quality";
  }
  if (quality > 0.3) {
    return "balanced";
  }
  return "speed";
}

// Map expo barcode types to vision camera types
function mapBarcodeTypes(
  expoTypes: ExpoBarcodeType[],
): VisionCameraBarcodeType[] {
  return expoTypes.map((type) => BARCODE_TYPE_MAP[type]);
}

// Map vision camera code to our barcode result
function mapCodeToResult(code: Code): BarcodeResult | null {
  // Use type guard instead of type assertion for safety
  if (!isVisionCameraBarcodeType(code.type)) return null;

  const expoType = BARCODE_TYPE_REVERSE_MAP[code.type];
  if (!expoType) return null;

  return {
    data: code.value ?? "",
    type: expoType,
    bounds: code.frame
      ? {
          x: code.frame.x,
          y: code.frame.y,
          width: code.frame.width,
          height: code.frame.height,
        }
      : undefined,
  };
}

/**
 * Camera component using react-native-vision-camera.
 * Provides barcode scanning and photo capture capabilities.
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
    const cameraRef = useRef<Camera>(null);
    const device = useCameraDevice(facing);
    const { theme } = useTheme();

    const codeScanner = useCodeScanner({
      codeTypes: mapBarcodeTypes(barcodeTypes),
      onCodeScanned: useCallback(
        (codes: Code[]) => {
          if (!onBarcodeScanned || codes.length === 0) return;

          const result = mapCodeToResult(codes[0]);
          if (result) {
            onBarcodeScanned(result);
          }
        },
        [onBarcodeScanned],
      ),
    });

    useImperativeHandle(ref, () => ({
      takePicture: async (
        options?: PhotoOptions,
      ): Promise<PhotoResult | null> => {
        if (!cameraRef.current) return null;

        try {
          // Note: In vision-camera v4, quality is set at the Camera component level
          // via photoQualityBalance prop, not per-photo. The options.quality parameter
          // is accepted for API compatibility but the actual quality is determined
          // by the photoQuality prop passed to CameraView.
          const photo = await cameraRef.current.takePhoto({
            flash: "off",
          });

          return {
            uri: `file://${photo.path}`,
            width: photo.width,
            height: photo.height,
          };
        } catch {
          // Photo capture failed - return null to let caller handle gracefully
          return null;
        }
      },
    }));

    if (!device) {
      return (
        <View
          style={[
            styles.unavailable,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <Feather name="camera-off" size={48} color={theme.textSecondary} />
          <Text style={[styles.unavailableTitle, { color: theme.text }]}>
            Camera unavailable
          </Text>
          <Text
            style={[styles.unavailableSubtitle, { color: theme.textSecondary }]}
          >
            Try using the gallery to upload a photo
          </Text>
        </View>
      );
    }

    if (!isActive) {
      return null;
    }

    return (
      <Camera
        ref={cameraRef}
        style={[StyleSheet.absoluteFill, style]}
        device={device}
        isActive={isActive}
        photo
        photoQualityBalance={mapQualityToPhotoQualityBalance(photoQuality)}
        codeScanner={codeScanner}
        torch={enableTorch ? "on" : "off"}
      />
    );
  },
);

CameraView.displayName = "CameraView";

const styles = StyleSheet.create({
  unavailable: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing["3xl"],
  },
  unavailableTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: Spacing.sm,
  },
  unavailableSubtitle: {
    fontSize: 14,
    textAlign: "center",
  },
});
