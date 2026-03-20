import { z } from "zod";
import type { PhotoIntent } from "./preparation";

/**
 * Content types detected by the auto-classification system.
 * These describe WHAT is in the image, not what the user wants to do.
 */
export const contentTypes = [
  "prepared_meal",
  "nutrition_label",
  "restaurant_menu",
  "raw_ingredients",
  "grocery_receipt",
  "restaurant_receipt",
  "non_food",
  "has_barcode",
] as const;
export const contentTypeSchema = z.enum(contentTypes);
export type ContentType = z.infer<typeof contentTypeSchema>;

/**
 * PhotoIntent extended with "auto" for the API boundary.
 * "auto" is NOT added to the photoIntents array because INTENT_CONFIG
 * and getPromptForIntent() require concrete intents only.
 */
export type PhotoIntentOrAuto = PhotoIntent | "auto";

/**
 * Mapping from content type to the resolved PhotoIntent used for analysis.
 * Content types that don't map to a PhotoIntent (receipts, non_food) resolve to null.
 */
export const CONTENT_TYPE_TO_INTENT: Record<ContentType, PhotoIntent | null> = {
  prepared_meal: "log",
  nutrition_label: "label",
  restaurant_menu: "menu",
  raw_ingredients: "recipe",
  grocery_receipt: null,
  restaurant_receipt: null,
  non_food: null,
  has_barcode: null,
};

/**
 * Result from the auto-classification step.
 * Uses a flat schema (not discriminated union) for simplicity —
 * the barcode field is only meaningful for has_barcode/nutrition_label types.
 */
export const classifiedResultSchema = z.object({
  contentType: contentTypeSchema,
  confidence: z.number().min(0).max(1),
  barcode: z.string().nullable().default(null),
});

export type ClassifiedResult = z.infer<typeof classifiedResultSchema>;

/** Barcode format validation patterns */
const BARCODE_PATTERNS: RegExp[] = [
  /^\d{13}$/, // EAN-13
  /^\d{8}$/, // EAN-8
  /^\d{12}$/, // UPC-A
  /^\d{6,8}$/, // UPC-E
];

/** Validate that a string looks like a valid barcode number */
export function isValidBarcode(code: string): boolean {
  return BARCODE_PATTERNS.some((p) => p.test(code));
}
