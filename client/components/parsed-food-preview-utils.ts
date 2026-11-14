/**
 * Pure formatting utilities for ParsedFoodPreview.
 * Extracted for testability — no React or RN dependencies.
 */

/** Format a nutrient value, rounding to integer. Returns "?" for null. */
export function formatNutrientValue(value: number | null): string {
  return value != null ? String(Math.round(value)) : "?";
}

/** Format the macro summary line: "250 cal | P: 20 | C: 30 | F: 10". */
export function formatMacroLine(
  calories: number | null,
  protein: number | null,
  carbs: number | null,
  fat: number | null,
): string {
  return `${formatNutrientValue(calories)} cal | P: ${formatNutrientValue(protein)} | C: ${formatNutrientValue(carbs)} | F: ${formatNutrientValue(fat)}`;
}

/**
 * The caption under a parsed item. A lookup miss is stored with no calories,
 * which the day total counts as 0 — so it says so instead of showing nothing.
 */
export function nutritionCaption(item: {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}): string {
  if (item.calories == null) return "No nutrition found — logs as 0 cal";
  return formatMacroLine(item.calories, item.protein, item.carbs, item.fat);
}
