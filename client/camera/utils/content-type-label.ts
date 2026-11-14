import type { ContentType } from "@shared/constants/classification";

/** User-friendly labels for each content type */
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  prepared_meal: "Meal",
  nutrition_label: "Nutrition label",
  restaurant_menu: "Restaurant menu",
  raw_ingredients: "Ingredients",
  grocery_receipt: "Grocery receipt",
  restaurant_receipt: "Restaurant receipt",
  non_food: "Not food",
  has_barcode: "Barcode",
};

/** Get the user-friendly label for a content type */
export function getContentTypeLabel(contentType: ContentType): string {
  return CONTENT_TYPE_LABELS[contentType];
}
