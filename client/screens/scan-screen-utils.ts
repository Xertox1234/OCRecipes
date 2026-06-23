import type { ContentType } from "@shared/constants/classification";
import type { PhotoIntent } from "@shared/constants/preparation";
import type { PremiumFeatureKey, PremiumFeatures } from "@shared/types/premium";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";
import { logger } from "@/lib/logger";

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
  | { kind: "reset" }
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
    return { kind: "reset" };
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
  return route ? { kind: "navigate", route } : { kind: "reset" };
}

/** Whether the confidence is high enough to auto-route without confirmation */
export function shouldAutoRoute(confidence: number): boolean {
  return confidence >= 0.7;
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
