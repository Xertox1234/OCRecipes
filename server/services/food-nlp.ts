import pLimit from "p-limit";
import { z } from "zod";
import { lookupNutrition } from "./nutrition-lookup";
import { openai } from "../lib/openai";
import {
  sanitizeUserInput,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
} from "../lib/ai-safety";

const limit = pLimit(5);

/** Schema for validating the AI food parsing response */
const foodNlpResponseSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unit: z.string(),
    }),
  ),
});
export interface ParsedFoodItem {
  name: string;
  quantity: number;
  unit: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  servingSize: string | null;
}

/**
 * Parses natural language text into structured food items with nutrition data.
 * E.g., "2 eggs and toast with butter" -> [{name: "egg", quantity: 2, unit: "large"}, ...]
 */
export async function parseNaturalLanguageFood(
  text: string,
): Promise<ParsedFoodItem[]> {
  // Sanitize user input before sending to AI
  const sanitizedText = sanitizeUserInput(text);

  let response;
  try {
    response = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        temperature: 0.1,
        max_completion_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a food parsing assistant. Parse the user's natural language food description into structured items.
Return JSON: { "items": [{ "name": string, "quantity": number, "unit": string }] }
- "name" should be the common food name suitable for nutrition database lookup
- "quantity" should be a number (default 1 if not specified)
- "unit" should be a common serving unit (e.g., "medium", "cup", "slice", "tablespoon", "piece", "oz", "g")
- If multiple foods mentioned, return each as a separate item
- Be specific: "toast with butter" becomes two items: "whole wheat toast" and "butter"
- Use standard serving sizes when unspecified

${SYSTEM_PROMPT_BOUNDARY}`,
          },
          {
            role: "user",
            content: sanitizedText,
          },
        ],
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    console.error("Food NLP parsing error:", error);
    return [];
  }

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  // Validate AI response against expected schema
  const parsed = validateAiResponse(JSON.parse(content), foodNlpResponseSchema);
  if (!parsed || !Array.isArray(parsed.items)) return [];

  // Look up nutrition for all parsed items in parallel (rate-limited)
  const settled = await Promise.allSettled(
    parsed.items.map((item) =>
      limit(() => {
        const searchTerm = `${item.quantity} ${item.unit} ${item.name}`;
        return lookupNutrition(searchTerm);
      }),
    ),
  );

  const results: ParsedFoodItem[] = parsed.items.map((item, i) => {
    const outcome = settled[i];
    const nutrition = outcome.status === "fulfilled" ? outcome.value : null;

    return {
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      calories: nutrition
        ? parseFloat(String(nutrition.calories)) * item.quantity
        : null,
      protein: nutrition
        ? parseFloat(String(nutrition.protein)) * item.quantity
        : null,
      carbs: nutrition
        ? parseFloat(String(nutrition.carbs)) * item.quantity
        : null,
      fat: nutrition ? parseFloat(String(nutrition.fat)) * item.quantity : null,
      servingSize: nutrition?.servingSize || `${item.quantity} ${item.unit}`,
    };
  });

  return results;
}
