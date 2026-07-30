import type { ContentType } from "@shared/constants/classification";
import type { PhotoIntent } from "@shared/constants/preparation";
import type { PremiumFeatureKey, PremiumFeatures } from "@shared/types/premium";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";
import { LOCK_THRESHOLD_FRAMES } from "@/camera/components/ScanReticle-utils";
import { logger } from "@/lib/logger";
import type { ProductSummary, ScanPhase } from "@/camera/types/scan-phase";
import type { ScanFlag } from "@shared/types/scan-flags";
import {
  pickTopSafetyFlag,
  pickTopDisplayFlag,
} from "@shared/types/scan-flags";
import type { VerificationLevel } from "@shared/types/verification";

/** Screen routing target for auto-classification results */
export type ClassificationRoute =
  | { screen: "PhotoAnalysis"; params: RootStackParamList["PhotoAnalysis"] }
  | { screen: "LabelAnalysis"; params: RootStackParamList["LabelAnalysis"] }
  | { screen: "MenuScanResult"; params: RootStackParamList["MenuScanResult"] }
  | {
      screen: "CookSessionCapture";
      params: RootStackParamList["CookSessionCapture"];
    }
  | { screen: "ReceiptCapture"; params: undefined }
  | {
      screen: "NutritionDetail";
      params: RootStackParamList["NutritionDetail"];
    };

/** User-friendly labels for each content type */
const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  prepared_meal: "Meal",
  nutrition_label: "Nutrition label",
  restaurant_menu: "Restaurant menu",
  raw_ingredients: "Ingredients",
  grocery_receipt: "Grocery receipt",
  restaurant_receipt: "Restaurant receipt",
  non_food: "Not food",
  has_barcode: "Barcode",
};

/** Premium feature gates for content types that require subscription */
const PREMIUM_GATES: Partial<
  Record<ContentType, { feature: PremiumFeatureKey; label: string }>
> = {
  restaurant_menu: { feature: "menuScanner", label: "Menu scanning" },
  raw_ingredients: { feature: "cookAndTrack", label: "Cook & Track" },
  grocery_receipt: { feature: "receiptScanner", label: "Receipt scanning" },
  restaurant_receipt: { feature: "receiptScanner", label: "Receipt scanning" },
};

/**
 * Determine the navigation route for a given content type.
 * Returns null for non_food (should show error instead of routing).
 */
export function getRouteForContentType(
  contentType: ContentType,
  imageUri: string,
  resolvedIntent: PhotoIntent | null,
  barcode: string | null,
  localOCRText?: string,
): ClassificationRoute | null {
  switch (contentType) {
    case "prepared_meal":
      return {
        screen: "PhotoAnalysis",
        params: { imageUri, intent: resolvedIntent ?? "log" },
      };
    case "nutrition_label":
      return {
        screen: "LabelAnalysis",
        params: { imageUri },
      };
    case "restaurant_menu":
      return {
        screen: "MenuScanResult",
        params: { imageUri, localOCRText },
      };
    case "raw_ingredients":
      return {
        screen: "CookSessionCapture",
        params: { initialPhotoUri: imageUri },
      };
    case "grocery_receipt":
    case "restaurant_receipt":
      return {
        screen: "ReceiptCapture",
        params: undefined,
      };
    case "has_barcode":
      return barcode
        ? { screen: "NutritionDetail", params: { barcode } }
        : null;
    case "non_food":
      return null;
  }
}

/**
 * Compute on-device OCR text for the smart-scan menu path so MenuScanResult can
 * render an instant local skeleton while the AI analysis loads (the OCR race-swap
 * that MenuScanResultScreen performs from `localOCRText`). OCR is gated to
 * `restaurant_menu` — its only consumer — so non-menu scans never pay the
 * recognition cost. Failure is non-fatal: log and return undefined so the caller
 * navigates without a preview and the server analysis still runs (mirrors the
 * label-mode OCR handling in ScanScreen.onShutterPress).
 */
export async function resolveMenuLocalOCRText(
  contentType: ContentType,
  imageUri: string,
  recognizeText: (uri: string) => Promise<{ text: string }>,
): Promise<string | undefined> {
  if (contentType !== "restaurant_menu") return undefined;
  try {
    const result = await recognizeText(imageUri);
    return result.text || undefined;
  } catch (err) {
    logger.error(
      "[ScanScreen smart menu OCR] recognition failed; navigating without preview",
      err,
    );
    return undefined;
  }
}

/** A side effect the smart-scan confirm handler should perform. */
export type SmartConfirmAction =
  | { kind: "navigate"; route: ClassificationRoute }
  | { kind: "blocked"; gate: { feature: PremiumFeatureKey; label: string } } // premium gate hit
  | { kind: "unrecognized" } // content type has no destination route
  | { kind: "abort" };

/**
 * Resolve what a smart-scan confirm tap should do: premium-gate the content type,
 * compute the menu OCR head-start, re-check liveness across the OCR await, and
 * pick the destination route. Extracted from `ScanScreen.onSmartPhotoConfirm` so
 * the gate / OCR-gating / liveness-abort / routing branches are unit-testable with
 * the OCR fn and liveness signal injected — the component keeps only the
 * synchronous re-entrancy guard and the dispatch/navigate side effects.
 *
 * `isStillLive` is read AFTER the OCR await: on-device OCR can take ~1s, during
 * which the user may leave the scan screen (blur → RESET). Returning `abort`
 * prevents navigating onto a screen they already dismissed. Gate-block and the
 * no-contentType fallback return before the await (no liveness check needed).
 */
export async function resolveSmartConfirmAction({
  classification,
  imageUri,
  features,
  recognizeText,
  isStillLive,
}: {
  classification: Pick<
    PhotoAnalysisResponse,
    "contentType" | "resolvedIntent" | "barcode"
  >;
  imageUri: string;
  features: PremiumFeatures;
  recognizeText: (uri: string) => Promise<{ text: string }>;
  isStillLive: () => boolean;
}): Promise<SmartConfirmAction> {
  const contentType = classification.contentType;
  if (!contentType) {
    return {
      kind: "navigate",
      route: {
        screen: "PhotoAnalysis",
        params: { imageUri, intent: classification.resolvedIntent ?? "log" },
      },
    };
  }
  const gate = getPremiumGate(contentType);
  if (gate && !features[gate.feature]) {
    return { kind: "blocked", gate };
  }
  const localOCRText = await resolveMenuLocalOCRText(
    contentType,
    imageUri,
    recognizeText,
  );
  if (!isStillLive()) return { kind: "abort" };
  const route = getRouteForContentType(
    contentType,
    imageUri,
    classification.resolvedIntent ?? null,
    classification.barcode ?? null,
    localOCRText,
  );
  return route ? { kind: "navigate", route } : { kind: "unrecognized" };
}

/** Get a user-friendly confirmation message for a content type */
export function getConfirmationMessage(contentType: ContentType): string {
  const label = CONTENT_TYPE_LABELS[contentType];
  return `This looks like a ${label.toLowerCase()}. Is that right?`;
}

/** Get the user-friendly label for a content type */
export function getContentTypeLabel(contentType: ContentType): string {
  return CONTENT_TYPE_LABELS[contentType];
}

/** Check if a content type requires a premium subscription */
export function getPremiumGate(
  contentType: ContentType,
): { feature: PremiumFeatureKey; label: string } | null {
  return PREMIUM_GATES[contentType] ?? null;
}

/** Barcode multi-frame tracking state read from `scanPhaseRef`, not the render closure. */
export type BarcodeTrackingState =
  | { status: "idle" }
  | { status: "tracking"; barcode: string; frameCount: number };

export type BarcodeTrackingDecision =
  | { action: "start"; barcode: string; frameCount: 1 }
  | { action: "update"; frameCount: number; confidence: number }
  | { action: "lock"; frameCount: number };

// confidence reaches 1.0 at LOCK_THRESHOLD_FRAMES (7) consecutive matching
// frames; lock fires at ≥0.85 (6 frames). Shared with ScanReticle-utils so the
// reticle's visual confidence ring can never desync from the real lock math.
const LOCK_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Decide what a newly-scanned barcode frame does to the current tracking state:
 * start tracking a new barcode, accumulate confidence on the same one, or lock
 * once confidence crosses the threshold. Pure so the frame-accumulation math
 * (previously inline in ScanScreen.onBarcodeScanned) is unit-testable without a
 * camera — the multi-frame lock had zero test coverage before this.
 */
export function evaluateBarcodeDetection(
  tracking: BarcodeTrackingState,
  scannedBarcode: string,
): BarcodeTrackingDecision {
  if (tracking.status === "idle" || scannedBarcode !== tracking.barcode) {
    return { action: "start", barcode: scannedBarcode, frameCount: 1 };
  }
  const frameCount = tracking.frameCount + 1;
  const confidence = Math.min(frameCount / LOCK_THRESHOLD_FRAMES, 1.0);
  if (confidence >= LOCK_CONFIDENCE_THRESHOLD) {
    return { action: "lock", frameCount };
  }
  return { action: "update", frameCount, confidence };
}

/**
 * Map a `GET /api/nutrition/barcode/:barcode` response into the `ProductSummary`
 * the scan chip renders.
 *
 * Extracted from ScanScreen's `fetchProductInfo` so the mapping is unit-testable
 * — in particular so the `verificationLevel` pass-through has a regression test.
 * That field was silently dropped before, which is why step 1 could not tell a
 * verified product from an unverified one.
 *
 * The flag helpers must stay the SHARED ones (`pickTopSafetyFlag` /
 * `pickTopDisplayFlag`) rather than being re-derived here — a prior refactor
 * updated one call site only and desynced two display surfaces.
 */
export function buildProductSummary(
  data: {
    productName?: string;
    brandName?: string;
    imageUrl?: string;
    verificationLevel?: VerificationLevel;
  },
  flags: ScanFlag[],
): ProductSummary {
  return {
    name: data.productName ?? "Unknown product",
    brand: data.brandName ?? undefined,
    imageUri: data.imageUrl ?? undefined,
    safetyFlag: pickTopSafetyFlag(flags),
    topFlag: pickTopDisplayFlag(flags),
    verificationLevel: data.verificationLevel,
  };
}

/** What a shutter press should do in a given phase. */
export type CapturePlan = {
  /** Take a photo at all. `false` means the shutter press is a deliberate no-op. */
  capture: boolean;
  /**
   * Run on-device OCR and pass the result to `STEP_PHOTO_CAPTURED`.
   *
   * Scoped to the STEP2 nutrition-panel dispatch ONLY — it is not "does this
   * phase ever OCR". `HUNTING` runs its own recognition for the label-mode and
   * smart-menu previews (into `localOCRText`), which is a different payload on
   * a different route.
   */
  runStepOcr: boolean;
};

/**
 * Decide whether a shutter press captures in this phase, and whether that
 * capture carries recognised label text.
 *
 * ONE decision for three call sites that each kept their own phase list:
 * `onShutterPress`'s entry guard, its OCR branch, and `shutterArmed`. Those
 * lists diverged twice on this branch, and the second divergence shipped
 * `LABEL_PROMPTED` as a terminal dead-end — the reducer accepted
 * `STEP_PHOTO_CAPTURED` from it while the guard silently dropped the tap, so
 * the flow's new primary button did nothing and the barcode-only escape hatch
 * had already unmounted with the chip.
 *
 * The switch is deliberately exhaustive with NO `default` clause: that is what
 * makes a newly added `ScanPhase` a compile error here instead of a phase the
 * capture gate silently ignores. Do not add a fall-through — it would recreate
 * the bug class in a new location.
 */
export function getCapturePlan(phase: ScanPhase): CapturePlan {
  switch (phase.type) {
    // Smart scan / label mode. Captures, but its recognition goes to
    // `localOCRText` on another route, not `STEP_PHOTO_CAPTURED`.
    case "HUNTING":
      return { capture: true, runStepOcr: false };
    // BARCODE_LOCKED is retained alongside LABEL_PROMPTED so a capture taken
    // before the chip's primary button is pressed still completes step 2 rather
    // than being dropped — same rationale as the reducer's branch.
    case "BARCODE_LOCKED":
    case "LABEL_PROMPTED":
      return { capture: true, runStepOcr: true };
    // Step 3 (package front). Captured, but the front carries no nutrition
    // panel and the phase's own `ocrText` (from step 2) is what moves forward.
    case "STEP2_CONFIRMED":
      return { capture: true, runStepOcr: false };
    case "IDLE":
    case "BARCODE_TRACKING":
    case "STEP2_REVIEWING":
    case "STEP3_REVIEWING":
    case "SESSION_COMPLETE":
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return { capture: false, runStepOcr: false };
  }
}

/**
 * Build the `NutritionDetail` route params from a completed scan session.
 *
 * Passes the WHOLE payload rather than cherry-picking fields. The previous
 * navigate sent only `{ barcode, ocrText }`, so the nutrition-panel and
 * package-front photos the user deliberately captured were discarded at the
 * navigation boundary — steps 2 and 3 produced artifacts nothing consumed.
 *
 * Keys are omitted rather than set to `undefined` so the three-valued `ocrText`
 * contract survives: absent = no label step ran, `null` = captured but
 * unreadable, string = readable.
 */
export function buildNutritionDetailParams(
  phase: Extract<ScanPhase, { type: "SESSION_COMPLETE" }>,
): {
  barcode: string;
  ocrText?: string | null;
  nutritionImageUri?: string;
  frontImageUri?: string;
} {
  const params: {
    barcode: string;
    ocrText?: string | null;
    nutritionImageUri?: string;
    frontImageUri?: string;
  } = { barcode: phase.barcode };

  if ("ocrText" in phase && phase.ocrText !== undefined) {
    params.ocrText = phase.ocrText;
  }
  if (phase.nutritionImageUri !== undefined) {
    params.nutritionImageUri = phase.nutritionImageUri;
  }
  if (phase.frontImageUri !== undefined) {
    params.frontImageUri = phase.frontImageUri;
  }
  return params;
}
