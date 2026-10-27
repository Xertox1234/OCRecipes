/**
 * Pure helpers for NutritionStep. No React Native imports — safe for Vitest.
 */

/**
 * Strips characters that are not digits or a decimal separator, treats a
 * comma as the decimal point (comma-decimal keypads send ","), and collapses
 * any repeated separators to the first one. Accepts empty strings — the
 * wizard treats blank fields as "skip nutrition". The result always parses
 * with `parseDecimalInput`.
 *
 * Examples:
 *  - "12a3" → "123"
 *  - "12,5" → "12.5"
 *  - "1.2.3" → "1.23"
 *  - "abc"  → ""
 */
export function sanitizeNumericInput(value: string): string {
  return value
    .replace(/,/g, ".")
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1");
}

/**
 * True when any of the four macro fields has a non-empty value. The Nutrition
 * step itself is optional — this helper is used by the PreviewStep and the
 * wizard's dirty tracking to decide whether to show "Skip" vs "Next".
 */
export function hasAnyNutritionValue(nutrition: {
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}): boolean {
  return Boolean(
    nutrition.calories || nutrition.protein || nutrition.carbs || nutrition.fat,
  );
}
