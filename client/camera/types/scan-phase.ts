import type { BarcodeResult } from "../types";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";

export interface ProductSummary {
  name: string;
  brand?: string;
  imageUri?: string;
}

type Bounds = NonNullable<BarcodeResult["bounds"]>;

export type ScanPhase =
  | { type: "IDLE" }
  | { type: "HUNTING" }
  | {
      type: "BARCODE_TRACKING";
      barcode: string;
      bounds: Bounds;
      frameCount: number;
    }
  | {
      type: "BARCODE_LOCKED";
      barcode: string;
      bounds: Bounds;
      product?: ProductSummary;
    }
  | { type: "STEP2_CAPTURING"; barcode: string; product?: ProductSummary }
  | {
      type: "STEP2_REVIEWING";
      barcode: string;
      product?: ProductSummary;
      ocrText: string;
      imageUri: string;
    }
  | {
      type: "STEP2_CONFIRMED";
      barcode: string;
      product?: ProductSummary;
      nutritionImageUri: string;
      ocrText: string;
    }
  | {
      type: "STEP3_CAPTURING";
      barcode: string;
      product?: ProductSummary;
      nutritionImageUri: string;
      ocrText: string;
    }
  | {
      type: "STEP3_REVIEWING";
      barcode: string;
      product?: ProductSummary;
      nutritionImageUri: string;
      ocrText: string;
      frontImageUri: string;
    }
  | {
      type: "SESSION_COMPLETE";
      barcode: string;
      nutritionImageUri?: string;
      frontImageUri?: string;
      ocrText?: string;
    }
  | { type: "CLASSIFYING"; imageUri: string }
  | {
      type: "SMART_CONFIRMED";
      imageUri: string;
      classification: PhotoAnalysisResponse;
    }
  | { type: "SMART_ERROR"; imageUri: string; error: string };

export type ScanAction =
  | { type: "CAMERA_READY" }
  | { type: "FIRST_BARCODE_DETECTED"; barcode: string; bounds: Bounds }
  | { type: "BARCODE_UPDATED"; bounds: Bounds }
  | { type: "BARCODE_LOCKED" }
  | { type: "PRODUCT_LOADED"; product: ProductSummary }
  | { type: "BARCODE_LOST" }
  | { type: "CONFIRM_PRODUCT" }
  | { type: "ADD_NUTRITION_PHOTO" }
  | { type: "ADD_FRONT_PHOTO" }
  | { type: "STEP_PHOTO_CAPTURED"; imageUri: string; ocrText?: string }
  | { type: "STEP_CONFIRMED" }
  | { type: "SMART_PHOTO_INITIATED"; imageUri: string }
  | { type: "CLASSIFICATION_SUCCEEDED"; classification: PhotoAnalysisResponse }
  | { type: "CLASSIFICATION_FAILED"; error: string }
  | { type: "RESET" };
