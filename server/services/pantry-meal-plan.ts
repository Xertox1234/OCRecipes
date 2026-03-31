import { z } from "zod";
import type { PantryItem, UserProfile } from "@shared/schema";
import { openai, OPENAI_TIMEOUT_HEAVY_MS } from "../lib/openai";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { buildDietaryContext } from "./meal-suggestions";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("pantry-meal-plan");

// ============================================================================
// TYPES
// ============================================================================

export interface PantryMealPlanInput {
  pantryItems: PantryItem[];
  userProfile: UserProfile | null;
  dailyTargets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  days: number;
  householdSize: number;
}

export interface GeneratedMeal {
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  title: string;
  description: string;
  servings: number;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  difficulty: "Easy" | "Medium" | "Hard";
  ingredients: { name: string; quantity: string; unit: string }[];
  instructions: string[];
  dietTags: string[];
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
}

export interface GeneratedDay {
  dayNumber: number;
  meals: GeneratedMeal[];
}

export interface GeneratedMealPlan {
  days: GeneratedDay[];
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

const generatedMealSchema = z.object({
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  servings: z.number().int().min(1).max(20),
  prepTimeMinutes: z.number().int().min(0).max(1440),
  cookTimeMinutes: z.number().int().min(0).max(1440),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  ingredients: z.array(
    z.object({
      name: z.string().min(1),
      quantity: z.coerce.string(),
      unit: z.coerce.string(),
    }),
  ),
  instructions: z
    .union([z.string(), z.array(z.string())])
    .transform((val): string[] =>
      Array.isArray(val)
        ? val.filter((s) => s.length > 0)
        : val
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
    ),
  dietTags: z.array(z.string()).default([]),
  caloriesPerServing: z.number().min(0),
  proteinPerServing: z.number().min(0),
  carbsPerServing: z.number().min(0),
  fatPerServing: z.number().min(0),
});

const generatedDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  meals: z.array(generatedMealSchema).min(1),
});

const aiResponseSchema = z.object({
  days: z.array(generatedDaySchema).min(1),
});

export { generatedMealSchema, aiResponseSchema };

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format pantry items for the AI prompt, prioritizing items expiring soonest.
 */
function formatPantryItems(items: PantryItem[]): string {
  const now = new Date();

  // Sort by expiration: soonest-expiring first, then items without expiry
  const sorted = [...items].sort((a, b) => {
    if (!a.expiresAt && !b.expiresAt) return 0;
    if (!a.expiresAt) return 1;
    if (!b.expiresAt) return -1;
    return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
  });

  return sorted
    .map((item) => {
      const parts = [`- ${sanitizeUserInput(item.name)}`];
      if (item.quantity) parts[0] += `: ${item.quantity}`;
      if (item.unit) parts[0] += ` ${item.unit}`;
      if (item.category && item.category !== "other") {
        parts[0] += ` (${item.category})`;
      }
      if (item.expiresAt) {
        const daysLeft = Math.ceil(
          (new Date(item.expiresAt).getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (daysLeft <= 3) {
          parts[0] += ` ⚠️ EXPIRES IN ${daysLeft} DAY${daysLeft !== 1 ? "S" : ""}`;
        } else if (daysLeft <= 7) {
          parts[0] += ` (expires in ${daysLeft} days)`;
        }
      }
      return parts[0];
    })
    .join("\n");
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Generate a multi-day meal plan based on the user's pantry items and dietary
 * profile. Uses GPT-4o to create practical recipes that maximize usage of
 * available ingredients, prioritizing items that are expiring soon.
 */
export async function generateMealPlanFromPantry(
  input: PantryMealPlanInput,
): Promise<GeneratedMealPlan> {
  if (input.pantryItems.length === 0) {
    throw new Error("No pantry items available to generate a meal plan");
  }

  const dietaryContext = buildDietaryContext(input.userProfile);
  const pantryList = formatPantryItems(input.pantryItems);

  const systemPrompt = `You are a professional meal planner and chef. Generate a practical multi-day meal plan using ONLY the ingredients the user has in their pantry. You may assume basic pantry staples are available (salt, pepper, oil, water, common spices). Prioritize ingredients that are expiring soon. Return JSON only.\n\n${SYSTEM_PROMPT_BOUNDARY}`;

  const userPrompt = `Generate a ${input.days}-day meal plan using my pantry ingredients.

PANTRY INVENTORY:
${pantryList}

DAILY NUTRITION TARGETS (per person):
- Calories: ${input.dailyTargets.calories} cal
- Protein: ${input.dailyTargets.protein}g
- Carbs: ${input.dailyTargets.carbs}g
- Fat: ${input.dailyTargets.fat}g

HOUSEHOLD SIZE: ${input.householdSize} ${input.householdSize === 1 ? "person" : "people"}

${dietaryContext ? `DIETARY REQUIREMENTS:\n${dietaryContext}\n` : ""}
RULES:
1. Each day should have breakfast, lunch, and dinner. Add snacks only if they fit the calorie budget.
2. Use as many pantry items as possible — minimize waste.
3. Prioritize items marked as expiring soon.
4. Set servings to match the household size (${input.householdSize}).
5. Nutrition values should be PER SERVING.
6. Include clear, step-by-step cooking instructions.
7. Keep meals practical and realistic for home cooking.
8. Vary meals across days — avoid repeating the same dish.

Respond with JSON: { "days": [{ "dayNumber": 1, "meals": [...] }, ...] }

Each meal needs: mealType, title, description, servings, prepTimeMinutes, cookTimeMinutes, difficulty, ingredients (name, quantity, unit), instructions, dietTags, caloriesPerServing, proteinPerServing, carbsPerServing, fatPerServing.`;

  let response;
  try {
    response = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_completion_tokens: 8000,
      },
      { timeout: OPENAI_TIMEOUT_HEAVY_MS },
    );
  } catch (error) {
    log.error({ err: toError(error) }, "pantry meal plan generation API error");
    throw new Error("Failed to generate meal plan. Please try again.");
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from AI");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI returned invalid JSON response");
  }

  const validated = aiResponseSchema.parse(parsed);
  return validated;
}
