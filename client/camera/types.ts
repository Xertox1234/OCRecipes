import type { StyleProp, ViewStyle } from "react-native";
import type {
  ExpoBarcodeType,
  BarcodeResult,
  PhotoResult,
  CameraPermissionResult,
} from "@shared/types/camera";
import type { Text as OCRText } from "react-native-vision-camera-ocr-plus";

export type { OCRText };

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

// Local type for snapshot OCR results (from @react-native-ml-kit/text-recognition)
export interface LocalOCRBlock {
  text: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface LocalOCRResult {
  text: string;
  blocks: LocalOCRBlock[];
}

// Camera ref interface for imperative operations
export interface CameraRef {
  takePicture(options?: PhotoOptions): Promise<PhotoResult | null>;
  /** Get the most recent OCR result from the frame processor (label mode only) */
  getLatestOCRResult?: () => OCRText | null;
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
   * Maps to V5's qualityPrioritization on usePhotoOutput:
   * - > 0.7: "quality" (prioritizes image quality)
   * - > 0.3: "balanced" (balanced speed/quality)
   * - <= 0.3: "speed" (prioritizes capture speed)
   * @default undefined (uses "balanced")
   */
  photoQuality?: number;
  /** Style for the camera view */
  style?: StyleProp<ViewStyle>;
  /** Enable on-device OCR via frame processor (label mode only).
   * Mutually exclusive with barcode scanning — only enable when barcodeTypes is empty. */
  enableOCR?: boolean;
  /** Called when OCR text detection state changes (text enters/exits viewfinder) */
  onTextDetected?: (detected: boolean) => void;
  /** Called with raw OCR result after each processed frame */
  onOCRResult?: (text: OCRText) => void;
}
