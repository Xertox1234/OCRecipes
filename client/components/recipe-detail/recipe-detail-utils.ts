import type { NutritionData } from "./NutritionCard";

/**
 * Formats prep and cook times into a display string.
 * Returns null if both are zero/undefined.
 */
export function formatTimeDisplay(
  prepTimeMinutes?: number | null,
  cookTimeMinutes?: number | null,
): string | null {
  const prep = prepTimeMinutes || 0;
  const cook = cookTimeMinutes || 0;
  const total = prep + cook;
  if (total === 0) return null;

  const parts = [];
  if (prep) parts.push(`${prep} min prep`);
  if (cook) parts.push(`${cook} min cook`);
  return parts.join(" · ");
}

/**
 * Parses decimal-string nutrition fields into a NutritionData object.
 * Returns null if no calories data exists.
 */
export function parseNutritionData(fields: {
  caloriesPerServing?: string | null;
  proteinPerServing?: string | null;
  carbsPerServing?: string | null;
  fatPerServing?: string | null;
}): NutritionData | null {
  if (!fields.caloriesPerServing) return null;
  return {
    calories: parseFloat(fields.caloriesPerServing),
    protein: fields.proteinPerServing
      ? parseFloat(fields.proteinPerServing)
      : undefined,
    carbs: fields.carbsPerServing
      ? parseFloat(fields.carbsPerServing)
      : undefined,
    fat: fields.fatPerServing ? parseFloat(fields.fatPerServing) : undefined,
  };
}

/**
 * Line height for recipe step text. 20.001, not 20, on purpose (QA #30).
 *
 * iOS draws a Text into a container exactly the size of its frame, and with
 * no numberOfLines the last line that fits is clipped instead of wrapped.
 * Far down a long scroll, float rounding can return a frame a hair short of
 * its measured height (43.99988 instead of 44 for a 2-line step). With a
 * whole-number line height the measured height has no slack, so the last
 * line is dropped and the one above it is cut mid-word. The extra 0.001pt
 * per line makes every step measure up to the next pixel, which absorbs the
 * rounding. Do not "clean" it back to 20.
 */
export const STEP_TEXT_LINE_HEIGHT = 20.001;
