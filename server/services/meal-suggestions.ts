import crypto from "crypto";
import { z } from "zod";
import type { UserProfile } from "@shared/schema";
import type { MealSuggestion } from "@shared/types/meal-suggestions";
import { openai, OPENAI_TIMEOUT_HEAVY_MS } from "../lib/openai";

// Zod schema for validating AI response
const ingredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.coerce.string().optional(),
  unit: z.string().optional(),
});

const mealSuggestionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  reasoning: z.string().min(1).max(500),
  calories: z.number().int().min(0),
  protein: z.number().int().min(0),
  carbs: z.number().int().min(0),
  fat: z.number().int().min(0),
  prepTimeMinutes: z.number().int().min(0),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  ingredients: z.array(ingredientSchema).min(1),
  instructions: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val.join("\n") : val)),
  dietTags: z.array(z.string()).default([]),
});

const aiResponseSchema = z.object({
  suggestions: z.array(mealSuggestionSchema).length(3),
});

export { mealSuggestionSchema, aiResponseSchema };

export interface MealSuggestionInput {
  userId: string;
  date: string;
  mealType: string;
  userProfile: UserProfile | null;
  dailyTargets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  existingMeals: { title: string; calories: number; mealType: string }[];
  remainingBudget: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}

/**
 * Build dietary context string from user profile
 */
function buildDietaryContext(userProfile: UserProfile | null): string {
  if (!userProfile) return "";

  const parts: string[] = [];

  if (
    userProfile.allergies &&
    Array.isArray(userProfile.allergies) &&
    userProfile.allergies.length > 0
  ) {
    const allergyNames = (userProfile.allergies as { name: string }[]).map(
      (a) => a.name,
    );
    parts.push(`MUST AVOID these allergens: ${allergyNames.join(", ")}`);
  }
  if (userProfile.dietType) {
    parts.push(`Diet type: ${userProfile.dietType}`);
  }
  if (
    userProfile.foodDislikes &&
    Array.isArray(userProfile.foodDislikes) &&
    userProfile.foodDislikes.length > 0
  ) {
    parts.push(`Dislikes: ${userProfile.foodDislikes.join(", ")}`);
  }
  if (userProfile.cookingSkillLevel) {
    parts.push(`Cooking skill: ${userProfile.cookingSkillLevel}`);
  }
  if (userProfile.cookingTimeAvailable) {
    parts.push(`Preferred cooking time: ${userProfile.cookingTimeAvailable}`);
  }
  if (
    userProfile.cuisinePreferences &&
    Array.isArray(userProfile.cuisinePreferences) &&
    userProfile.cuisinePreferences.length > 0
  ) {
    parts.push(
      `Cuisine preferences: ${userProfile.cuisinePreferences.join(", ")}`,
    );
  }

  return parts.length > 0 ? parts.join(". ") + "." : "";
}

export { buildDietaryContext };

/**
 * Build a deterministic cache key for meal suggestion requests.
 */
export function buildSuggestionCacheKey(
  userId: string,
  date: string,
  mealType: string,
  profileHash: string,
  planHash: string,
): string {
  const raw = `${userId}:${date}:${mealType}:${profileHash}:${planHash}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Generate 3 meal suggestions using OpenAI GPT-4o.
 */
export async function generateMealSuggestions(
  input: MealSuggestionInput,
): Promise<MealSuggestion[]> {
  const dietaryContext = buildDietaryContext(input.userProfile);

  const existingMealsSummary =
    input.existingMeals.length > 0
      ? input.existingMeals
          .map((m) => `- ${m.mealType}: ${m.title} (${m.calories} cal)`)
          .join("\n")
      : "No meals planned yet today.";

  const systemPrompt = `You are a professional nutritionist and meal planner. Generate exactly 3 meal suggestions that are practical, balanced, and tailored to the user's needs. Return JSON only.`;

  const userPrompt = `Generate 3 ${input.mealType} suggestions for ${input.date}.

DAILY TARGETS: ${input.dailyTargets.calories} cal, ${input.dailyTargets.protein}g protein, ${input.dailyTargets.carbs}g carbs, ${input.dailyTargets.fat}g fat

REMAINING BUDGET: ${input.remainingBudget.calories} cal, ${input.remainingBudget.protein}g protein, ${input.remainingBudget.carbs}g carbs, ${input.remainingBudget.fat}g fat

ALREADY PLANNED TODAY:
${existingMealsSummary}

${dietaryContext ? `DIETARY REQUIREMENTS:\n${dietaryContext}` : ""}

Each suggestion needs: title, description, reasoning (why this fits), calories, protein, carbs, fat, prepTimeMinutes, difficulty (Easy/Medium/Hard), ingredients (name, quantity, unit), instructions, dietTags.

Respond with JSON: { "suggestions": [...] }`;

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
        temperature: 0.8,
        max_completion_tokens: 3000,
      },
      { timeout: OPENAI_TIMEOUT_HEAVY_MS },
    );
  } catch (error) {
    console.error("Meal suggestions API error:", error);
    throw new Error("Failed to generate meal suggestions. Please try again.");
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
  return validated.suggestions;
}
