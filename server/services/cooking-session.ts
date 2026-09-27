import { openai, OPENAI_TIMEOUT_HEAVY_MS, MODEL_HEAVY } from "../lib/openai";
import { SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import {
  photoAnalysisResponseSchema,
  type CookingSessionIngredient,
  type CookSessionNutritionItem,
  type CookSessionNutritionSummary,
} from "@shared/types/cook-session";
import { batchNutritionLookup, type NutritionData } from "./nutrition-lookup";
import { nutrientValues, scaleToGrams } from "./portion-nutrition";
import {
  calculateCookedNutrition,
  preparationToCookingMethod,
} from "./cooking-adjustment";
import { createServiceLogger } from "../lib/logger";
import { roundToOneDecimal } from "../lib/math";
import { normalizeUnit } from "../lib/recipe-normalization";

const log = createServiceLogger("cooking-session");

// ============================================================================
// INGREDIENT ANALYSIS
// ============================================================================

const INGREDIENT_ANALYSIS_PROMPT = `You are a nutrition assistant analyzing photos of raw cooking ingredients.

Identify each distinct ingredient visible in the photo(s). For each ingredient provide:
1. Name (specific: "chicken breast" not "chicken")
2. Estimated quantity in a numeric value
3. Unit (e.g., "g", "oz", "cup", "piece", "medium")
4. Your confidence level (0-1)
5. Food category: one of "protein", "vegetable", "grain", "fruit", "dairy", "beverage", "other"

Rules:
- Focus on RAW INGREDIENTS, not prepared dishes
- Use metric or US standard units
- If quantity is uncertain, provide your best estimate with lower confidence
- Be specific with cuts and forms (e.g., "diced onion", "boneless chicken thigh")

${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON only matching this schema:
{
  "ingredients": [
    {
      "name": "ingredient name",
      "quantity": 200,
      "unit": "g",
      "confidence": 0.85,
      "category": "protein"
    }
  ]
}`;

export class IngredientAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngredientAnalysisError";
  }
}

/**
 * Analyze a photo of cooking ingredients using OpenAI Vision.
 *
 * Returns detected ingredients with `photoId: ""` — the caller must set the
 * real photoId on each returned ingredient before merging into a session.
 */
export async function analyzeIngredientPhoto(
  imageBase64: string,
  mimetype: string,
  currentPhotoCount: number,
): Promise<CookingSessionIngredient[]> {
  const completion = await openai.chat.completions.create(
    {
      model: MODEL_HEAVY,
      temperature: 0.2,
      messages: [
        { role: "system", content: INGREDIENT_ANALYSIS_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimetype};base64,${imageBase64}`,
                detail: currentPhotoCount >= 4 ? "low" : "high",
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1000,
    },
    { timeout: OPENAI_TIMEOUT_HEAVY_MS },
  );

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) {
    throw new IngredientAnalysisError("No response from ingredient analysis");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new IngredientAnalysisError("Invalid JSON from ingredient analysis");
  }

  const validated = photoAnalysisResponseSchema.safeParse(parsed);
  if (!validated.success) {
    log.warn(
      { zodErrors: validated.error.flatten() },
      "ingredient analysis validation failed",
    );
    throw new IngredientAnalysisError(
      "Unexpected response format from ingredient analysis",
    );
  }

  return validated.data.ingredients.map((detected) => ({
    id: crypto.randomUUID(),
    name: detected.name,
    quantity: detected.quantity,
    unit: detected.unit,
    confidence: detected.confidence,
    category: detected.category,
    photoId: "",
    userEdited: false,
  }));
}

// ============================================================================
// NUTRITION CALCULATION
// ============================================================================

type Nutrients = CookSessionNutritionSummary["total"];

/**
 * Grams per unit, keyed by `normalizeUnit`'s output. Volumes assume the
 * density of water (1 g/ml): close for milk, stock and oil, but about double
 * for flour or sugar measured by the cup.
 */
const GRAMS_PER_UNIT: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.35,
  lb: 453.59,
  ml: 1,
  l: 1000,
  litre: 1000,
  litres: 1000,
  cup: 240,
  tbsp: 15,
  tsp: 5,
};

/** The ingredient's weight in grams, or null for a unit with no weight ("piece"). */
function ingredientGrams(ingredient: CookingSessionIngredient): number | null {
  const perUnit = GRAMS_PER_UNIT[normalizeUnit(ingredient.unit)];
  return perUnit === undefined ? null : ingredient.quantity * perUnit;
}

interface IngredientPortion {
  nutrients: Nutrients;
  servingSize: string;
  /** Raw per-100 g values and weight for the cooking adjustment; null when the source can't be weighed. */
  cookable: { per100g: Nutrients; grams: number } | null;
}

/**
 * One ingredient's nutrition for its quantity. The lookup answers per 100 g
 * (or per serving, for API Ninjas), so it is scaled to the ingredient's weight.
 * A unit with no weight keeps the per-100 g values under a marked serving
 * size, as Quick Log does; a source basis that can't be weighed ("1 serving")
 * keeps its own values and label.
 */
function ingredientPortion(
  ingredient: CookingSessionIngredient,
  nutrition: NutritionData | null | undefined,
): IngredientPortion {
  const label = `${ingredient.quantity} ${ingredient.unit}`;
  if (!nutrition) {
    return { nutrients: ZERO_NUTRIENTS, servingSize: label, cookable: null };
  }

  const per100g = scaleToGrams(nutrition, 100);
  if (!per100g) {
    return {
      nutrients: orZero(nutrientValues(nutrition)),
      servingSize: nutrition.servingSize || label,
      cookable: null,
    };
  }

  const grams = ingredientGrams(ingredient);
  const portion = grams === null ? null : scaleToGrams(nutrition, grams);
  if (grams === null || !portion) {
    return {
      nutrients: orZero(per100g),
      servingSize: "100 g (portion unknown)",
      cookable: { per100g: orZero(per100g), grams: 100 },
    };
  }
  return {
    nutrients: orZero(portion),
    servingSize: label,
    cookable: { per100g: orZero(per100g), grams },
  };
}

const ZERO_NUTRIENTS: Nutrients = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  sodium: 0,
};

function orZero(values: Record<keyof Nutrients, number | null>): Nutrients {
  return {
    calories: values.calories ?? 0,
    protein: values.protein ?? 0,
    carbs: values.carbs ?? 0,
    fat: values.fat ?? 0,
    fiber: values.fiber ?? 0,
    sugar: values.sugar ?? 0,
    sodium: values.sodium ?? 0,
  };
}

/** Look up each ingredient by name; the quantity is applied by scaling. */
async function lookupIngredients(
  ingredients: CookingSessionIngredient[],
): Promise<IngredientPortion[]> {
  const names = [...new Set(ingredients.map((i) => i.name))];
  const nutritionMap = await batchNutritionLookup(names);
  return ingredients.map((ingredient) =>
    ingredientPortion(ingredient, nutritionMap.get(ingredient.name)),
  );
}

/**
 * Calculate full nutrition summary for a cooking session's ingredients.
 *
 * Performs batch nutrition lookup, applies per-ingredient or global cooking
 * method adjustments, and returns rounded totals plus per-item breakdown.
 */
export async function calculateSessionNutrition(
  ingredients: CookingSessionIngredient[],
  globalCookingMethod?: string,
): Promise<CookSessionNutritionSummary> {
  const portions = await lookupIngredients(ingredients);

  const items: CookSessionNutritionItem[] = [];
  const total = { ...ZERO_NUTRIENTS };

  for (let i = 0; i < ingredients.length; i++) {
    const ingredient = ingredients[i];
    const portion = portions[i];
    let finalNutrition = portion.nutrients;

    // Apply cooking method adjustment if specified
    const methodStr = ingredient.preparationMethod || globalCookingMethod;
    let appliedMethod: string | undefined;
    if (
      portion.cookable &&
      methodStr &&
      methodStr !== "raw" &&
      methodStr !== "As Served"
    ) {
      const cookingMethod = preparationToCookingMethod(methodStr);
      const cooked = calculateCookedNutrition(
        portion.cookable.per100g,
        portion.cookable.grams,
        ingredient.category,
        cookingMethod,
      );

      if (cooked.adjustmentApplied) {
        finalNutrition = {
          calories: cooked.calories,
          protein: cooked.protein,
          carbs: cooked.carbs,
          fat: cooked.fat,
          fiber: cooked.fiber,
          sugar: cooked.sugar,
          sodium: cooked.sodium,
        };
        appliedMethod = cookingMethod;
      }
    }

    const item: CookSessionNutritionItem = {
      ingredientId: ingredient.id,
      name: ingredient.name,
      ...finalNutrition,
      servingSize: portion.servingSize,
      cookingMethodApplied: appliedMethod,
    };
    items.push(item);

    total.calories += item.calories;
    total.protein += item.protein;
    total.carbs += item.carbs;
    total.fat += item.fat;
    total.fiber += item.fiber;
    total.sugar += item.sugar;
    total.sodium += item.sodium;
  }

  // Round totals
  total.calories = Math.round(total.calories);
  total.protein = roundToOneDecimal(total.protein);
  total.carbs = roundToOneDecimal(total.carbs);
  total.fat = roundToOneDecimal(total.fat);
  total.fiber = roundToOneDecimal(total.fiber);
  total.sugar = roundToOneDecimal(total.sugar);
  total.sodium = Math.round(total.sodium);

  return { total, items };
}

/**
 * Calculate simple macro totals (calories, protein, carbs, fat) for a
 * cooking session's ingredients. Used when logging a meal.
 */
export async function calculateSessionMacros(
  ingredients: CookingSessionIngredient[],
): Promise<{ calories: number; protein: number; carbs: number; fat: number }> {
  const portions = await lookupIngredients(ingredients);

  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const { nutrients } of portions) {
    totals.calories += nutrients.calories;
    totals.protein += nutrients.protein;
    totals.carbs += nutrients.carbs;
    totals.fat += nutrients.fat;
  }

  // Round consistently with calculateSessionNutrition
  totals.calories = Math.round(totals.calories);
  totals.protein = roundToOneDecimal(totals.protein);
  totals.carbs = roundToOneDecimal(totals.carbs);
  totals.fat = roundToOneDecimal(totals.fat);

  return totals;
}
