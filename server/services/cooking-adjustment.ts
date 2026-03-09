/**
 * Cooking method nutrition adjustments based on USDA Nutrient Retention Factors
 * (Release 6) and USDA Cooking Yield Tables.
 *
 * Adjusts raw ingredient nutrition values to reflect changes from cooking:
 * - Yield factors: weight change (moisture loss/gain)
 * - Retention factors: nutrient degradation
 * - Fat addition: absorbed fat from cooking medium
 */

import type { FoodCategory } from "@shared/constants/preparation";

export type CookingMethod =
  | "raw"
  | "boiled"
  | "steamed"
  | "grilled"
  | "baked"
  | "fried"
  | "deep-fried"
  | "sauteed"
  | "microwaved"
  | "roasted"
  | "stir-fried"
  | "poached"
  | "braised";

type FoodGroup = "meat_poultry" | "vegetables" | "grains_pasta" | "other";

/** Map FoodCategory to the coarser food groups used by USDA tables. */
function toFoodGroup(category: FoodCategory): FoodGroup {
  switch (category) {
    case "protein":
      return "meat_poultry";
    case "vegetable":
    case "fruit":
      return "vegetables";
    case "grain":
      return "grains_pasta";
    default:
      return "other";
  }
}

/**
 * Yield factor: cooked weight / raw weight.
 * Values < 1 mean moisture loss, > 1 mean moisture gain.
 */
const YIELD_FACTORS: Record<
  FoodGroup,
  Partial<Record<CookingMethod, number>>
> = {
  meat_poultry: {
    raw: 1.0,
    grilled: 0.72,
    baked: 0.75,
    roasted: 0.73,
    fried: 0.78,
    "deep-fried": 0.8,
    sauteed: 0.8,
    boiled: 0.85,
    steamed: 0.85,
    braised: 0.82,
    poached: 0.88,
    microwaved: 0.82,
    "stir-fried": 0.78,
  },
  vegetables: {
    raw: 1.0,
    boiled: 0.9,
    steamed: 0.95,
    sauteed: 0.88,
    roasted: 0.78,
    grilled: 0.82,
    microwaved: 0.93,
    "stir-fried": 0.85,
    baked: 0.82,
    fried: 0.85,
    "deep-fried": 0.82,
    braised: 0.88,
    poached: 0.92,
  },
  grains_pasta: {
    raw: 1.0,
    boiled: 2.0, // pasta/rice absorb water
    steamed: 1.8,
    baked: 0.85,
    fried: 0.9,
    "deep-fried": 0.85,
    microwaved: 1.6,
    sauteed: 0.92,
    roasted: 0.85,
    grilled: 0.9,
    "stir-fried": 0.9,
    braised: 1.5,
    poached: 1.8,
  },
  other: {
    raw: 1.0,
    boiled: 0.9,
    steamed: 0.93,
    baked: 0.85,
    fried: 0.85,
    "deep-fried": 0.82,
    sauteed: 0.88,
    grilled: 0.82,
    roasted: 0.82,
    microwaved: 0.9,
    "stir-fried": 0.85,
    braised: 0.88,
    poached: 0.92,
  },
};

/**
 * Macro retention factors: fraction of each macro retained after cooking.
 * Protein and fat are generally stable; carbs can change slightly.
 */
const MACRO_RETENTION: Record<
  FoodGroup,
  Partial<
    Record<
      CookingMethod,
      { protein: number; fat: number; carbs: number; calories: number }
    >
  >
> = {
  meat_poultry: {
    raw: { protein: 1.0, fat: 1.0, carbs: 1.0, calories: 1.0 },
    grilled: { protein: 0.95, fat: 0.8, carbs: 1.0, calories: 0.88 },
    baked: { protein: 0.97, fat: 0.85, carbs: 1.0, calories: 0.9 },
    roasted: { protein: 0.95, fat: 0.82, carbs: 1.0, calories: 0.88 },
    fried: { protein: 0.95, fat: 0.95, carbs: 1.0, calories: 1.0 },
    "deep-fried": { protein: 0.93, fat: 1.0, carbs: 1.0, calories: 1.05 },
    sauteed: { protein: 0.95, fat: 0.9, carbs: 1.0, calories: 0.95 },
    boiled: { protein: 0.9, fat: 0.75, carbs: 1.0, calories: 0.85 },
    steamed: { protein: 0.95, fat: 0.9, carbs: 1.0, calories: 0.93 },
    braised: { protein: 0.93, fat: 0.8, carbs: 1.0, calories: 0.88 },
    poached: { protein: 0.93, fat: 0.8, carbs: 1.0, calories: 0.88 },
    microwaved: { protein: 0.97, fat: 0.92, carbs: 1.0, calories: 0.95 },
    "stir-fried": { protein: 0.95, fat: 0.92, carbs: 1.0, calories: 0.95 },
  },
  vegetables: {
    raw: { protein: 1.0, fat: 1.0, carbs: 1.0, calories: 1.0 },
    boiled: { protein: 0.85, fat: 0.9, carbs: 0.85, calories: 0.85 },
    steamed: { protein: 0.95, fat: 0.95, carbs: 0.95, calories: 0.95 },
    sauteed: { protein: 0.92, fat: 0.95, carbs: 0.9, calories: 0.95 },
    roasted: { protein: 0.9, fat: 0.9, carbs: 0.88, calories: 0.9 },
    grilled: { protein: 0.92, fat: 0.9, carbs: 0.88, calories: 0.9 },
    microwaved: { protein: 0.95, fat: 0.95, carbs: 0.95, calories: 0.95 },
    "stir-fried": { protein: 0.92, fat: 0.95, carbs: 0.9, calories: 0.95 },
    baked: { protein: 0.9, fat: 0.9, carbs: 0.88, calories: 0.9 },
    fried: { protein: 0.9, fat: 0.95, carbs: 0.9, calories: 0.98 },
    "deep-fried": { protein: 0.88, fat: 1.0, carbs: 0.88, calories: 1.05 },
    braised: { protein: 0.88, fat: 0.9, carbs: 0.88, calories: 0.88 },
    poached: { protein: 0.9, fat: 0.92, carbs: 0.9, calories: 0.9 },
  },
  grains_pasta: {
    raw: { protein: 1.0, fat: 1.0, carbs: 1.0, calories: 1.0 },
    boiled: { protein: 0.95, fat: 0.95, carbs: 0.95, calories: 0.95 },
    steamed: { protein: 0.97, fat: 0.97, carbs: 0.97, calories: 0.97 },
    baked: { protein: 0.95, fat: 0.9, carbs: 0.9, calories: 0.92 },
    fried: { protein: 0.95, fat: 0.95, carbs: 0.95, calories: 1.0 },
    "deep-fried": { protein: 0.93, fat: 1.0, carbs: 0.93, calories: 1.05 },
    sauteed: { protein: 0.95, fat: 0.95, carbs: 0.95, calories: 0.97 },
    microwaved: { protein: 0.97, fat: 0.97, carbs: 0.97, calories: 0.97 },
    roasted: { protein: 0.95, fat: 0.9, carbs: 0.9, calories: 0.92 },
    grilled: { protein: 0.95, fat: 0.92, carbs: 0.92, calories: 0.93 },
    "stir-fried": { protein: 0.95, fat: 0.95, carbs: 0.95, calories: 0.97 },
    braised: { protein: 0.95, fat: 0.92, carbs: 0.93, calories: 0.93 },
    poached: { protein: 0.95, fat: 0.95, carbs: 0.95, calories: 0.95 },
  },
  other: {
    raw: { protein: 1.0, fat: 1.0, carbs: 1.0, calories: 1.0 },
    boiled: { protein: 0.9, fat: 0.9, carbs: 0.9, calories: 0.9 },
    steamed: { protein: 0.95, fat: 0.95, carbs: 0.95, calories: 0.95 },
    baked: { protein: 0.93, fat: 0.9, carbs: 0.9, calories: 0.92 },
    fried: { protein: 0.93, fat: 0.95, carbs: 0.93, calories: 0.98 },
    "deep-fried": { protein: 0.9, fat: 1.0, carbs: 0.9, calories: 1.05 },
    sauteed: { protein: 0.93, fat: 0.95, carbs: 0.93, calories: 0.95 },
    grilled: { protein: 0.93, fat: 0.9, carbs: 0.9, calories: 0.92 },
    roasted: { protein: 0.93, fat: 0.9, carbs: 0.9, calories: 0.92 },
    microwaved: { protein: 0.95, fat: 0.95, carbs: 0.95, calories: 0.95 },
    "stir-fried": { protein: 0.93, fat: 0.95, carbs: 0.93, calories: 0.95 },
    braised: { protein: 0.92, fat: 0.9, carbs: 0.9, calories: 0.9 },
    poached: { protein: 0.93, fat: 0.92, carbs: 0.93, calories: 0.93 },
  },
};

/**
 * Fat absorbed from cooking medium (grams per 100g of food).
 * Only applicable for frying/sautéing methods.
 */
const FAT_ADDITION_PER_100G: Partial<Record<CookingMethod, number>> = {
  fried: 5,
  "deep-fried": 12,
  sauteed: 3,
  "stir-fried": 4,
};

export interface RawNutritionPer100g {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
}

export interface CookedNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  cookedWeightG: number;
  cookingMethod: CookingMethod;
  adjustmentApplied: boolean;
}

export function calculateCookedNutrition(
  rawPer100g: RawNutritionPer100g,
  rawWeightG: number,
  foodCategory: FoodCategory,
  cookingMethod: CookingMethod,
): CookedNutrition {
  const group = toFoodGroup(foodCategory);

  // Scale raw values from per-100g to actual weight
  const scale = rawWeightG / 100;
  const rawCalories = rawPer100g.calories * scale;
  const rawProtein = rawPer100g.protein * scale;
  const rawCarbs = rawPer100g.carbs * scale;
  const rawFat = rawPer100g.fat * scale;
  const rawFiber = rawPer100g.fiber * scale;
  const rawSugar = rawPer100g.sugar * scale;
  const rawSodium = rawPer100g.sodium * scale;

  if (cookingMethod === "raw") {
    return {
      calories: Math.round(rawCalories),
      protein: Math.round(rawProtein * 10) / 10,
      carbs: Math.round(rawCarbs * 10) / 10,
      fat: Math.round(rawFat * 10) / 10,
      fiber: Math.round(rawFiber * 10) / 10,
      sugar: Math.round(rawSugar * 10) / 10,
      sodium: Math.round(rawSodium),
      cookedWeightG: rawWeightG,
      cookingMethod,
      adjustmentApplied: false,
    };
  }

  const yieldFactor = YIELD_FACTORS[group]?.[cookingMethod] ?? 0.85;
  const retention = MACRO_RETENTION[group]?.[cookingMethod] ?? {
    protein: 0.93,
    fat: 0.9,
    carbs: 0.92,
    calories: 0.93,
  };

  const fatAddition = (FAT_ADDITION_PER_100G[cookingMethod] ?? 0) * scale;

  const cookedCalories = rawCalories * retention.calories + fatAddition * 9;
  const cookedProtein = rawProtein * retention.protein;
  const cookedCarbs = rawCarbs * retention.carbs;
  const cookedFat = rawFat * retention.fat + fatAddition;
  // Fiber and sugar use carb retention as approximation
  const cookedFiber = rawFiber * retention.carbs;
  const cookedSugar = rawSugar * retention.carbs;
  // Sodium generally retained (slightly increases in concentration due to water loss)
  const cookedSodium = rawSodium;

  return {
    calories: Math.round(cookedCalories),
    protein: Math.round(cookedProtein * 10) / 10,
    carbs: Math.round(cookedCarbs * 10) / 10,
    fat: Math.round(cookedFat * 10) / 10,
    fiber: Math.round(cookedFiber * 10) / 10,
    sugar: Math.round(cookedSugar * 10) / 10,
    sodium: Math.round(cookedSodium),
    cookedWeightG: Math.round(rawWeightG * yieldFactor),
    cookingMethod,
    adjustmentApplied: true,
  };
}

/** Map PREPARATION_OPTIONS strings to CookingMethod values. */
export function preparationToCookingMethod(preparation: string): CookingMethod {
  const map: Record<string, CookingMethod> = {
    "As Served": "raw",
    Raw: "raw",
    Grilled: "grilled",
    "Pan-Fried": "fried",
    "Deep-Fried": "deep-fried",
    Baked: "baked",
    Roasted: "roasted",
    Steamed: "steamed",
    Boiled: "boiled",
    Sautéed: "sauteed",
    "Stir-Fried": "stir-fried",
    Fried: "fried",
    Cooked: "baked", // generic fallback
  };
  return map[preparation] ?? "raw";
}

export const _testInternals = {
  YIELD_FACTORS,
  MACRO_RETENTION,
  FAT_ADDITION_PER_100G,
  toFoodGroup,
};
