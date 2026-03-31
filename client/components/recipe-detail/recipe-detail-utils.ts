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
