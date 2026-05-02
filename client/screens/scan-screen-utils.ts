import type { ContentType } from "@shared/constants/classification";
import type { PhotoIntent } from "@shared/constants/preparation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

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
  Record<ContentType, { feature: string; label: string }>
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
        screen: "PhotoAnalysis",
        params: { imageUri, intent: "menu" },
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
): { feature: string; label: string } | null {
  return PREMIUM_GATES[contentType] ?? null;
}
