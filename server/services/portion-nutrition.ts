import { parseServingGrams, scaleNutrients } from "./barcode-lookup";
import type { NutritionData } from "./nutrition-lookup";
import { roundToOneDecimal } from "../lib/math";

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

/**
 * The lookup answers per 100 g (or per serving, for API Ninjas); scale it to
 * the food's estimated weight. With no estimate, keep per-100 g values under a
 * marked serving size, as Quick Log does; a basis that can't be weighed
 * ("1 serving") keeps its own values and label.
 */
export function portionNutrition(
  nutrition: NutritionData,
  food: { quantity: string; grams?: number },
): NutritionData {
  if (food.grams) {
    const portion = scaleToGrams(nutrition, food.grams);
    if (portion) {
      const grams = Math.round(food.grams);
      return withValues(nutrition, portion, `${food.quantity} (${grams} g)`);
    }
  } else {
    const per100g = scaleToGrams(nutrition, 100);
    if (per100g) {
      return withValues(nutrition, per100g, "100 g (portion unknown)");
    }
  }
  return nutrition;
}

function withValues(
  nutrition: NutritionData,
  values: NutrientValues,
  servingSize: string,
): NutritionData {
  return {
    ...nutrition,
    calories: values.calories ?? 0,
    protein: values.protein ?? 0,
    carbs: values.carbs ?? 0,
    fat: values.fat ?? 0,
    fiber: values.fiber ?? 0,
    sugar: values.sugar ?? 0,
    sodium: values.sodium ?? 0,
    servingSize,
  };
}

export type NutrientTotals = Record<keyof NutrientValues, number>;

export function sumNutrients(parts: NutrientValues[]): NutrientTotals {
  const total = (key: keyof NutrientValues) =>
    roundToOneDecimal(parts.reduce((sum, part) => sum + (part[key] ?? 0), 0));
  return {
    calories: Math.round(total("calories")),
    protein: total("protein"),
    carbs: total("carbs"),
    fat: total("fat"),
    fiber: total("fiber"),
    sugar: total("sugar"),
    sodium: total("sodium"),
  };
}

function toNumber(value: unknown): number | null {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}
