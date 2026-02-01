import type { StyleProp, ViewStyle } from "react-native";
import type {
  ExpoBarcodeType,
  BarcodeResult,
  PhotoResult,
  CameraPermissionResult,
} from "@shared/types/camera";

export type {
  ExpoBarcodeType,
  BarcodeResult,
  PhotoResult,
  CameraPermissionResult,
};

// Camera facing direction
export type CameraFacing = "front" | "back";

// Photo quality options
export interface PhotoOptions {
  quality?: number; // 0-1
  skipProcessing?: boolean;
}

// Camera ref interface for imperative operations
export interface CameraRef {
  takePicture(options?: PhotoOptions): Promise<PhotoResult | null>;
}

// Props for the abstracted camera component
export interface CameraViewProps {
  /** Array of barcode types to scan */
  barcodeTypes: ExpoBarcodeType[];
  /** Callback when a barcode is scanned */
  onBarcodeScanned?: (result: BarcodeResult) => void;
  /** Enable/disable torch */
  enableTorch?: boolean;
  /** Camera facing direction */
  facing?: CameraFacing;
  /** Whether camera is active */
  isActive?: boolean;
  /**
   * Photo quality setting (0-1).
   * Maps to vision-camera's photoQualityBalance:
   * - > 0.7: "quality" (prioritizes image quality)
   * - > 0.3: "balanced" (balanced speed/quality)
   * - <= 0.3: "speed" (prioritizes capture speed)
   * @default undefined (uses "balanced")
   */
  photoQuality?: number;
  /** Style for the camera view */
  style?: StyleProp<ViewStyle>;
}
