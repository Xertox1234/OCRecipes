import type { BarcodeResult } from "../types";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";
import type { ScanFlag } from "@shared/types/scan-flags";
import type { VerificationLevel } from "@shared/types/verification";

export interface ProductSummary {
  name: string;
  brand?: string;
  imageUri?: string;
  /** Top safety flag for the scan-lock chip (highest severity), if any. */
  safetyFlag?: ScanFlag;
  /**
   * Top flag across ALL kinds (allergen OR universal/nutrition), for the
   * scan-lock chip badge — severity ties break toward allergen via
   * `pickTopFlag`. Additive alongside `safetyFlag` (Task 14, Smart Scan
   * Universal Nutrition Flags v1). `safetyFlag` is kept for its
   * safety-tier-only semantics (allergen fail-dangerous fields don't get
   * diluted by lower-priority universal flags in a shared field) — note it
   * is currently write-only on this type: ScanScreen's Phase-1 haptic reads
   * its own locally-computed `pickTopSafetyFlag` result, not this field.
   */
  topFlag?: ScanFlag;
  /**
   * Server-reported verification state for this barcode, from
   * `GET /api/nutrition/barcode/:barcode`. OPTIONAL on purpose: the chip
   * renders before the product fetch resolves (see ProductChip's note that the
   * name can arrive after the chip is shown), so `undefined` means "not loaded
   * yet" and callers must treat it as unverified — never as verified.
   */
  verificationLevel?: VerificationLevel;
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
  | {
      /**
       * The user confirmed the scanned product and asked to photograph its
       * nutrition panel. The chip is collapsed and the camera is live; the
       * NEXT capture completes step 2.
       *
       * This phase exists because taking a photo in BARCODE_LOCKED *is* the
       * advance to step 2 — there was no action representing "I want to do
       * step 2", so step 1's primary button had to be wired to
       * CONFIRM_PRODUCT, which ends the session instead.
       */
      type: "LABEL_PROMPTED";
      barcode: string;
      product?: ProductSummary;
    }
  | {
      type: "STEP2_REVIEWING";
      barcode: string;
      product?: ProductSummary;
      /**
       * Recognised label text, or `null` when a label WAS photographed but the
       * recognizer produced nothing usable.
       *
       * The distinction is load-bearing, not cosmetic: reaching a STEP2/STEP3
       * phase means the user deliberately photographed a nutrition panel, so
       * "absent" is not a possible reading here — only "readable" or
       * "unreadable". Collapsing the latter to `""` made it identical to the
       * barcode-only path, and `useNutritionLookup`'s truthiness guard then
       * skipped the label branch silently, presenting a wrong database value as
       * if it had been verified against the package.
       */
      ocrText: string | null;
      imageUri: string;
    }
  | {
      type: "STEP2_CONFIRMED";
      barcode: string;
      product?: ProductSummary;
      nutritionImageUri: string;
      /** See STEP2_REVIEWING — `null` means captured but unreadable. */
      ocrText: string | null;
    }
  | {
      type: "STEP3_REVIEWING";
      barcode: string;
      product?: ProductSummary;
      nutritionImageUri: string;
      /** See STEP2_REVIEWING — `null` means captured but unreadable. */
      ocrText: string | null;
      frontImageUri: string;
    }
  | {
      type: "SESSION_COMPLETE";
      barcode: string;
      nutritionImageUri?: string;
      frontImageUri?: string;
      /**
       * Three-valued on purpose: `undefined` = no label was ever captured
       * (barcode-only session), `null` = a label was captured but unreadable,
       * a string = readable label text.
       */
      ocrText?: string | null;
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
  | { type: "PROCEED_TO_LABEL" }
  | { type: "STEP_PHOTO_CAPTURED"; imageUri: string; ocrText?: string }
  | { type: "STEP_CONFIRMED" }
  | { type: "SMART_PHOTO_INITIATED"; imageUri: string }
  | { type: "CLASSIFICATION_SUCCEEDED"; classification: PhotoAnalysisResponse }
  | { type: "CLASSIFICATION_FAILED"; error: string }
  | { type: "SMART_CONFIRM_FAILED" }
  | { type: "RESET" };
