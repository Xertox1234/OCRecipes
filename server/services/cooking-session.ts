import { openai, OPENAI_TIMEOUT_HEAVY_MS, MODEL_HEAVY } from "../lib/openai";
import { SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import {
  photoAnalysisResponseSchema,
  type CookingSessionIngredient,
  type CookSessionNutritionItem,
  type CookSessionNutritionSummary,
} from "@shared/types/cook-session";
import { batchNutritionLookup } from "./nutrition-lookup";
import {
  calculateCookedNutrition,
  preparationToCookingMethod,
} from "./cooking-adjustment";
import { createServiceLogger } from "../lib/logger";

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
  // Build lookup queries: "quantity unit name"
  const lookupQueries = ingredients.map(
    (i) => `${i.quantity} ${i.unit} ${i.name}`,
  );

  const nutritionMap = await batchNutritionLookup(lookupQueries);

  const items: CookSessionNutritionItem[] = [];
  const total = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sugar: 0,
    sodium: 0,
  };

  for (let i = 0; i < ingredients.length; i++) {
    const ingredient = ingredients[i];
    const query = lookupQueries[i];
    const nutrition = nutritionMap.get(query);

    if (!nutrition) {
      items.push({
        ingredientId: ingredient.id,
        name: ingredient.name,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sugar: 0,
        sodium: 0,
        servingSize: `${ingredient.quantity} ${ingredient.unit}`,
      });
      continue;
    }

    // Apply cooking method adjustment if specified
    const methodStr = ingredient.preparationMethod || globalCookingMethod;
    let finalNutrition = {
      calories: nutrition.calories,
      protein: nutrition.protein,
      carbs: nutrition.carbs,
      fat: nutrition.fat,
      fiber: nutrition.fiber,
      sugar: nutrition.sugar,
      sodium: nutrition.sodium,
    };

    let appliedMethod: string | undefined;
    if (methodStr && methodStr !== "raw" && methodStr !== "As Served") {
      const cookingMethod = preparationToCookingMethod(methodStr);
      const cooked = calculateCookedNutrition(
        {
          calories: nutrition.calories,
          protein: nutrition.protein,
          carbs: nutrition.carbs,
          fat: nutrition.fat,
          fiber: nutrition.fiber,
          sugar: nutrition.sugar,
          sodium: nutrition.sodium,
        },
        ingredient.quantity,
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
      calories: finalNutrition.calories,
      protein: finalNutrition.protein,
      carbs: finalNutrition.carbs,
      fat: finalNutrition.fat,
      fiber: finalNutrition.fiber,
      sugar: finalNutrition.sugar,
      sodium: finalNutrition.sodium,
      servingSize: `${ingredient.quantity} ${ingredient.unit}`,
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
  total.protein = Math.round(total.protein * 10) / 10;
  total.carbs = Math.round(total.carbs * 10) / 10;
  total.fat = Math.round(total.fat * 10) / 10;
  total.fiber = Math.round(total.fiber * 10) / 10;
  total.sugar = Math.round(total.sugar * 10) / 10;
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
  const lookupQueries = ingredients.map(
    (i) => `${i.quantity} ${i.unit} ${i.name}`,
  );
  const nutritionMap = await batchNutritionLookup(lookupQueries);

  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (let i = 0; i < ingredients.length; i++) {
    const nutrition = nutritionMap.get(lookupQueries[i]);
    if (nutrition) {
      totals.calories += nutrition.calories;
      totals.protein += nutrition.protein;
      totals.carbs += nutrition.carbs;
      totals.fat += nutrition.fat;
    }
  }

  // Round consistently with calculateSessionNutrition
  totals.calories = Math.round(totals.calories);
  totals.protein = Math.round(totals.protein * 10) / 10;
  totals.carbs = Math.round(totals.carbs * 10) / 10;
  totals.fat = Math.round(totals.fat * 10) / 10;

  return totals;
}
