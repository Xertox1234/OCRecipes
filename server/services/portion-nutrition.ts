import { parseServingGrams, scaleNutrients } from "./barcode-lookup";
import type { NutritionData } from "./nutrition-lookup";

export type NutrientValues = Record<
  "calories" | "protein" | "carbs" | "fat" | "fiber" | "sugar" | "sodium",
  number | null
>;

/** A lookup result's seven values, unscaled; null where a value isn't numeric. */
export function nutrientValues(nutrition: NutritionData): NutrientValues {
  return {
    calories: toNumber(nutrition.calories),
    protein: toNumber(nutrition.protein),
    carbs: toNumber(nutrition.carbs),
    fat: toNumber(nutrition.fat),
    fiber: toNumber(nutrition.fiber),
    sugar: toNumber(nutrition.sugar),
    sodium: toNumber(nutrition.sodium),
  };
}

/**
 * Scale a lookup result to `grams` of the food, or null when its basis can't
 * be weighed ("1 serving").
 *
 * The basis comes from `servingSize`, never `source`: CNF/USDA return "100g",
 * API Ninjas a per-serving "<n>g", and a cache hit reports `source: "cache"`
 * whatever it held. Normalizing through the basis means a per-serving result
 * is never scaled twice. "ml" bases are read as grams (density ≈ 1).
 */
export function scaleToGrams(
  nutrition: NutritionData,
  grams: number,
): NutrientValues | null {
  const basisGrams = parseServingGrams(nutrition.servingSize);
  if (!basisGrams) return null;

  const values = nutrientValues(nutrition);
  const s = scaleNutrients(
    {
      calories: values.calories ?? undefined,
      protein: values.protein ?? undefined,
      carbs: values.carbs ?? undefined,
      fat: values.fat ?? undefined,
      fiber: values.fiber ?? undefined,
      sugar: values.sugar ?? undefined,
      sodium: values.sodium ?? undefined,
    },
    grams / basisGrams,
  );
  return {
    calories: s.calories ?? null,
    protein: s.protein ?? null,
    carbs: s.carbs ?? null,
    fat: s.fat ?? null,
    fiber: s.fiber ?? null,
    sugar: s.sugar ?? null,
    sodium: s.sodium ?? null,
  };
}

function toNumber(value: unknown): number | null {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}
