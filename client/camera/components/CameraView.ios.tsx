import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Camera,
  usePhotoOutput,
  useObjectOutput,
  isScannedCode,
  type CameraRef as VisionCameraRef,
  type ScannedObject,
  type ScannedObjectType,
} from "react-native-vision-camera";
import type { ExpoBarcodeType } from "@shared/types/camera";
import { Spacing } from "@/constants/theme";
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

    const objectTypes = mapBarcodeTypes(barcodeTypes);
    const objectOutput = useObjectOutput({
      types: objectTypes,
      onObjectsScanned:
        barcodeTypes.length > 0 ? handleObjectsScanned : undefined,
    });

    useEffect(() => {
      cameraRef.current?.controller
        ?.setTorchMode(enableTorch ? "on" : "off")
        .catch(() => {
          // Device may not have a torch; ignore
        });
    }, [enableTorch]);

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
      barcodeTypes.length > 0 ? [photoOutput, objectOutput] : [photoOutput];

    return (
      <Camera
        ref={cameraRef}
        style={[StyleSheet.absoluteFill, style]}
        device={facing}
        isActive={isActive}
        outputs={outputs}
        onError={(error) => {
          console.warn("[CameraView] Camera error:", error.message);
        }}
      />
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
        Try using the gallery to upload a photo
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
