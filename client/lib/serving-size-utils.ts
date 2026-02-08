/**
 * Serving size validation and normalization utilities.
 *
 * Open Food Facts data quality is inconsistent — some products have the
 * `serving_size` set to the TOTAL package weight instead of a single serving.
 * For example, a box of K-cup pods might list "236g" as the serving size,
 * which is the entire box, giving 944 kcal per "serving" when one pod is ~60 kcal.
 *
 * This module detects these issues and normalizes nutrition data so the user
 * always sees plausible per-serving values.
 *
 * Approach modeled after how apps like MyFitnessPal and Open Food Facts'
 * Smooth App handle serving sizes:
 *   1. Treat per-100g data as the source of truth
 *   2. Validate per-serving data against plausibility heuristics
 *   3. Allow user to adjust serving quantity
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServingSizeInfo {
  /** Display label, e.g. "1 pod (15 g)" or "100g" */
  displayLabel: string;
  /** Numeric weight in grams for the single serving (null if unknown) */
  grams: number | null;
  /** Whether this was auto-corrected from suspicious data */
  wasCorrected: boolean;
  /** Optional explanation shown to user when data was corrected */
  correctionReason?: string;
}

export interface NutritionPer100g {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export interface ValidatedNutrition {
  /** Nutrition values per single serving */
  perServing: NutritionPer100g;
  /** Nutrition values per 100g (source of truth) */
  per100g: NutritionPer100g;
  /** Validated serving size information */
  servingInfo: ServingSizeInfo;
  /** Whether the original serving data was trustworthy */
  isServingDataTrusted: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum plausible calories for a single serving of any food item.
 * For reference:
 *   - A Big Mac is ~550 kcal
 *   - A large Starbucks Frappuccino is ~500 kcal
 *   - A full restaurant entrée rarely exceeds 800 kcal per serving
 *
 * We use 800 kcal as the threshold — above this, the "serving" is
 * likely the entire multi-pack / box.
 */
const MAX_PLAUSIBLE_SERVING_CALORIES = 800;

/**
 * Maximum plausible serving weight in grams.
 * Most individual food servings are under 500g.
 * A serving of 236g for a 15g pod clearly means "whole box".
 */
const MAX_PLAUSIBLE_SERVING_GRAMS = 500;

/**
 * When calories per serving exceed this ratio compared to per-100g,
 * the serving_quantity likely represents the whole package.
 * A ratio > 3 means the "serving" is more than 300g, which is suspicious
 * for most packaged foods.
 */
const MAX_SERVING_TO_100G_CALORIE_RATIO = 3.0;

/**
 * Keywords in product names that indicate multi-unit packages where
 * the barcode covers the box, not an individual item.
 */
const MULTI_PACK_KEYWORDS = [
  "pods",
  "pod",
  "k-cup",
  "kcup",
  "k cup",
  "capsule",
  "capsules",
  "pack",
  "count",
  "ct",
  "single serve",
  "variety",
  "box of",
  "sachets",
  "packets",
  "pouches",
  "bars",
  "snack packs",
];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract numeric grams from a serving size string.
 *
 * Examples:
 *   "1 cup (240ml)"  → 240   (treats ml ≈ g for beverages)
 *   "15 g (15 g)"    → 15
 *   "236.0g"         → 236
 *   "1 pod (14g)"    → 14
 *   "30g"            → 30
 *   "2 tbsp (32g)"   → 32
 */
export function parseServingGrams(servingSize: string): number | null {
  if (!servingSize) return null;

  const lower = servingSize.toLowerCase().trim();

  // Pattern 1: explicit grams in parentheses — e.g. "1 cup (240g)" or "1 pod (14g)"
  const parenMatch = lower.match(/\((\d+\.?\d*)\s*(?:g|ml)\)/);
  if (parenMatch) {
    return parseFloat(parenMatch[1]);
  }

  // Pattern 2: trailing grams — e.g. "30g" or "236.0g" or "15 g"
  const trailingMatch = lower.match(/(\d+\.?\d*)\s*(?:g|ml)(?:\s|$)/);
  if (trailingMatch) {
    return parseFloat(trailingMatch[1]);
  }

  // Pattern 3: just a number (Open Food Facts sometimes puts just the weight)
  const numberOnly = lower.match(/^(\d+\.?\d*)$/);
  if (numberOnly) {
    return parseFloat(numberOnly[1]);
  }

  return null;
}

/**
 * Check if the product name suggests a multi-unit/multi-pack product.
 */
export function isMultiPackProduct(productName: string): boolean {
  if (!productName) return false;
  const lower = productName.toLowerCase();
  return MULTI_PACK_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Plausibility checking
// ---------------------------------------------------------------------------

export interface PlausibilityResult {
  isPlausible: boolean;
  reason?: string;
}

/**
 * Checks whether the per-serving nutrition data looks plausible.
 *
 * Returns { isPlausible: false, reason } when:
 *   - Calories per serving > 800 kcal (likely whole-package data)
 *   - Serving weight > 500g (likely whole-package weight)
 *   - The ratio of per-serving to per-100g calories is suspiciously high
 *     AND the product name contains multi-pack keywords
 */
export function checkServingPlausibility(
  caloriesPerServing: number | undefined,
  caloriesPer100g: number | undefined,
  servingGrams: number | null,
  productName: string,
): PlausibilityResult {
  // If we have no data to validate, trust what we have
  if (caloriesPerServing === undefined) {
    return { isPlausible: true };
  }

  // Check 1: Absolute calorie ceiling
  if (caloriesPerServing > MAX_PLAUSIBLE_SERVING_CALORIES) {
    return {
      isPlausible: false,
      reason: `${Math.round(caloriesPerServing)} cal per serving seems too high — this may be the total for the entire package.`,
    };
  }

  // Check 2: Serving weight ceiling
  if (servingGrams !== null && servingGrams > MAX_PLAUSIBLE_SERVING_GRAMS) {
    return {
      isPlausible: false,
      reason: `Serving size of ${servingGrams}g is unusually large — this may be the full package weight.`,
    };
  }

  // Check 3: Ratio check for multi-pack products
  if (
    caloriesPer100g !== undefined &&
    caloriesPer100g > 0 &&
    servingGrams !== null
  ) {
    const ratio = caloriesPerServing / caloriesPer100g;
    if (
      ratio > MAX_SERVING_TO_100G_CALORIE_RATIO &&
      isMultiPackProduct(productName)
    ) {
      return {
        isPlausible: false,
        reason: `This appears to be a multi-pack product — showing nutrition per individual serving instead of the full box.`,
      };
    }
  }

  return { isPlausible: true };
}

// ---------------------------------------------------------------------------
// Main validation & normalization
// ---------------------------------------------------------------------------

interface OpenFoodFactsNutriments {
  "energy-kcal_100g"?: number;
  "energy-kcal_serving"?: number;
  energy_100g?: number;
  energy_serving?: number;
  energy_value?: number;
  proteins_100g?: number;
  proteins_serving?: number;
  carbohydrates_100g?: number;
  carbohydrates_serving?: number;
  fat_100g?: number;
  fat_serving?: number;
  fiber_100g?: number;
  fiber_serving?: number;
  sugars_100g?: number;
  sugars_serving?: number;
  sodium_100g?: number;
  sodium_serving?: number;
  [key: string]: number | string | undefined;
}

interface OpenFoodFactsProduct {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: string | number;
  quantity?: string;
  nutriments?: OpenFoodFactsNutriments;
  image_url?: string;
  image_front_url?: string;
}

/**
 * Validates and normalizes Open Food Facts nutrition data.
 *
 * Strategy:
 *   1. Extract per-100g values (always present and reliable)
 *   2. Determine a valid serving size
 *   3. Check if the existing per-serving data is plausible
 *   4. If not plausible, recalculate per-serving from per-100g
 *      using a reasonable serving size (or fall back to per-100g)
 */
export function validateAndNormalizeNutrition(
  product: OpenFoodFactsProduct,
  barcode: string,
): ValidatedNutrition {
  const nutriments = product.nutriments || {};
  const productName = product.product_name || "";

  // Step 1: Extract per-100g values (source of truth)
  // Open Food Facts stores energy in various fields:
  //   - energy-kcal_100g: calories (kcal) — preferred
  //   - energy_100g: often in kJ — convert to kcal by dividing by 4.184
  //   - energy_value: sometimes kcal, sometimes kJ
  const rawCalories100g: number | undefined =
    nutriments["energy-kcal_100g"] ??
    (nutriments.energy_100g !== undefined
      ? Math.round(nutriments.energy_100g / 4.184)
      : undefined) ??
    nutriments.energy_value;

  const per100g: NutritionPer100g = {
    calories: rawCalories100g,
    protein: nutriments.proteins_100g,
    carbs: nutriments.carbohydrates_100g,
    fat: nutriments.fat_100g,
    fiber: nutriments.fiber_100g,
    sugar: nutriments.sugars_100g,
    sodium:
      nutriments.sodium_100g !== undefined
        ? nutriments.sodium_100g * 1000 // convert g → mg
        : undefined,
  };

  // Step 2: Determine serving size
  const rawServingSize = product.serving_size || product.quantity || "";
  const servingQuantity =
    typeof product.serving_quantity === "string"
      ? parseFloat(product.serving_quantity)
      : product.serving_quantity;
  const servingGrams =
    parseServingGrams(rawServingSize) ??
    (servingQuantity && isFinite(servingQuantity) ? servingQuantity : null);

  // Step 3: Extract existing per-serving data
  const existingPerServing: NutritionPer100g = {
    calories:
      nutriments["energy-kcal_serving"] ??
      (nutriments.energy_serving !== undefined
        ? Math.round(nutriments.energy_serving / 4.184)
        : undefined),
    protein: nutriments.proteins_serving,
    carbs: nutriments.carbohydrates_serving,
    fat: nutriments.fat_serving,
    fiber: nutriments.fiber_serving,
    sugar: nutriments.sugars_serving,
    sodium:
      nutriments.sodium_serving !== undefined
        ? nutriments.sodium_serving * 1000
        : undefined,
  };

  const hasExistingServingData = existingPerServing.calories !== undefined;

  // Step 4: Check plausibility
  const plausibility = checkServingPlausibility(
    existingPerServing.calories,
    per100g.calories,
    servingGrams,
    productName,
  );

  // Step 5: Build validated result
  if (hasExistingServingData && plausibility.isPlausible) {
    // Per-serving data looks good — use it directly
    return {
      perServing: existingPerServing,
      per100g,
      servingInfo: {
        displayLabel: rawServingSize || "1 serving",
        grams: servingGrams,
        wasCorrected: false,
      },
      isServingDataTrusted: true,
    };
  }

  if (!plausibility.isPlausible && per100g.calories !== undefined) {
    // Per-serving data is suspicious — recalculate from per-100g
    // Use a reasonable default serving size for multi-pack items
    const correctedServingGrams = estimateReasonableServingGrams(
      productName,
      per100g.calories,
    );
    const scale = correctedServingGrams / 100;

    return {
      perServing: scaleNutrition(per100g, scale),
      per100g,
      servingInfo: {
        displayLabel: `~${correctedServingGrams}g (estimated serving)`,
        grams: correctedServingGrams,
        wasCorrected: true,
        correctionReason: plausibility.reason,
      },
      isServingDataTrusted: false,
    };
  }

  if (
    !hasExistingServingData &&
    servingGrams &&
    servingGrams > 0 &&
    per100g.calories !== undefined
  ) {
    // No per-serving data exists, but we know the serving weight → calculate
    const servingGramsToUse =
      servingGrams > MAX_PLAUSIBLE_SERVING_GRAMS
        ? estimateReasonableServingGrams(productName, per100g.calories)
        : servingGrams;
    const scale = servingGramsToUse / 100;
    const wasCorrected = servingGramsToUse !== servingGrams;

    return {
      perServing: scaleNutrition(per100g, scale),
      per100g,
      servingInfo: {
        displayLabel: wasCorrected
          ? `~${servingGramsToUse}g (estimated serving)`
          : rawServingSize || `${servingGramsToUse}g`,
        grams: servingGramsToUse,
        wasCorrected,
        correctionReason: wasCorrected
          ? "Original serving size appeared to be the full package weight."
          : undefined,
      },
      isServingDataTrusted: !wasCorrected,
    };
  }

  // Fallback: only per-100g data available, no serving info
  return {
    perServing: per100g,
    per100g,
    servingInfo: {
      displayLabel: "100g",
      grams: 100,
      wasCorrected: false,
    },
    isServingDataTrusted: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scale all nutrition values by a factor.
 */
export function scaleNutrition(
  base: NutritionPer100g,
  factor: number,
): NutritionPer100g {
  const scale = (v: number | undefined) =>
    v !== undefined ? v * factor : undefined;

  return {
    calories: scale(base.calories),
    protein: scale(base.protein),
    carbs: scale(base.carbs),
    fat: scale(base.fat),
    fiber: scale(base.fiber),
    sugar: scale(base.sugar),
    sodium: scale(base.sodium),
  };
}

/**
 * Estimate a reasonable single-serving weight for a product.
 *
 * Uses category heuristics:
 *   - K-cups / pods: ~15g per pod
 *   - Bars: ~40g
 *   - Packets / sachets: ~28g
 *   - Default snack: ~30g
 *   - Default beverage mix: ~15g
 *
 * If nothing matches, falls back to a calorie-density approach:
 *   target ~150 kcal per serving → grams = (150 / cal_per_100g) × 100
 */
export function estimateReasonableServingGrams(
  productName: string,
  caloriesPer100g?: number,
): number {
  const lower = (productName || "").toLowerCase();

  // K-cup / pod products
  if (
    lower.includes("pod") ||
    lower.includes("k-cup") ||
    lower.includes("kcup") ||
    lower.includes("k cup") ||
    lower.includes("capsule") ||
    lower.includes("single serve")
  ) {
    return 15;
  }

  // Bars
  if (lower.includes("bar")) {
    return 40;
  }

  // Packets / sachets (instant oatmeal, drink mix, etc.)
  if (
    lower.includes("packet") ||
    lower.includes("sachet") ||
    lower.includes("pouch")
  ) {
    return 28;
  }

  // Calorie-density fallback: aim for ~150 kcal per serving
  if (caloriesPer100g && caloriesPer100g > 0) {
    const targetCalories = 150;
    const estimated = Math.round((targetCalories / caloriesPer100g) * 100);
    // Clamp to 10–200g
    return Math.max(10, Math.min(200, estimated));
  }

  // Generic default
  return 30;
}

/**
 * Build serving size options for the user to pick from.
 *
 * Returns an array of { label, grams, isDefault } options including:
 *   - The validated product serving (if available)
 *   - Common household measurements
 *   - 100g reference
 */
export function getServingSizeOptions(
  servingInfo: ServingSizeInfo,
  productName: string,
): { label: string; grams: number; isDefault: boolean }[] {
  const options: { label: string; grams: number; isDefault: boolean }[] = [];
  const usedGrams = new Set<number>();

  const addOption = (label: string, grams: number, isDefault: boolean) => {
    // Avoid duplicate gram values
    const rounded = Math.round(grams * 10) / 10;
    if (!usedGrams.has(rounded)) {
      usedGrams.add(rounded);
      options.push({ label, grams: rounded, isDefault });
    }
  };

  // Option 1: The validated product serving
  if (servingInfo.grams && servingInfo.grams !== 100) {
    addOption(servingInfo.displayLabel, servingInfo.grams, true);
  }

  // Option 2: Common household measurements
  addOption("1 tsp (4g)", 4, false);
  addOption("1 tbsp (12g)", 12, false);
  addOption("¼ cup (60g)", 60, false);
  addOption("1 cup (240g)", 240, false);

  // Option 3: 100g reference
  addOption("100g", 100, !servingInfo.grams || servingInfo.grams === 100);

  // Sort: default first, then by grams ascending
  options.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.grams - b.grams;
  });

  return options;
}
