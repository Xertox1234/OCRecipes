import { aiChat } from "../lib/ai-client";
import pLimit from "p-limit";
import { z } from "zod";
import { lookupNutrition, type NutritionData } from "./nutrition-lookup";
import {
  nutrientValues,
  scaleToGrams,
  type NutrientValues,
} from "./portion-nutrition";
import { OPENAI_TIMEOUT_FAST_MS } from "../lib/openai";
import {
  sanitizeUserInput,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
} from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("food-nlp");

const limit = pLimit(5);

/** Upper bound on one item's estimated weight — a whole large pizza is ~2 kg. */
const MAX_PORTION_GRAMS = 5000;

/**
 * Schema for validating the AI food parsing response. `lookupName` and `grams`
 * pass through as `unknown` and are validated per item (below): a bad value on
 * either degrades that one item (plain-name lookup / "portion unknown"), it
 * never fails the whole parse. (`.catch()` on the fields would do the same but
 * widens the schema's input type past what `validateAiResponse` accepts.)
 */
const foodNlpResponseSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unit: z.string(),
      lookupName: z.unknown().optional(),
      grams: z.unknown().optional(),
    }),
  ),
});

const lookupNameSchema = z.string().trim().min(1).max(100);
const portionGramsSchema = z.number().positive().max(MAX_PORTION_GRAMS);

function validOrUndefined<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

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
    response = await aiChat(
      "food-nlp-parse",
      {
        temperature: 0.1,
        // ~46 tokens per item with lookupName + grams (measured 2026-09-26:
        // 13 items = 597 tokens, which truncated at the old 500). 1500 fits ~30.
        max_completion_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a food parsing assistant. Parse the user's natural language food description into structured items.
Return JSON: { "items": [{ "name": string, "lookupName": string, "quantity": number, "unit": string, "grams": number }] }
- "name" is the common food name shown to the user (e.g., "egg", "whole wheat toast")
- "lookupName" describes the same food the way a nutrition database lists it: main food first, then type and preparation, comma-separated (e.g., "egg, chicken, whole, cooked", "bread, whole wheat, toasted", "rice, white, long-grain, cooked", "carbonated drinks, cola")
- "quantity" should be a number (default 1 if not specified)
- "unit" should be a common serving unit (e.g., "medium", "cup", "slice", "tablespoon", "piece", "oz", "g")
- "grams" is your best estimate of the total edible weight in grams of the whole amount described: all pieces together, without shells, peels, bones or pits. Use typical reference weights (e.g., 1 large egg ≈ 50, so 2 large eggs ≈ 100; 1 slice of bread ≈ 30; 1 medium banana ≈ 118; 1 cup of cooked rice ≈ 160; 1 tablespoon of butter ≈ 14; a 355 ml can of soda ≈ 370)
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
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );
  } catch (error) {
    log.error({ err: toError(error) }, "food NLP parsing error");
    throw new Error("Failed to parse food description. Please try again.");
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from food parsing");
  }

  // Validate AI response against expected schema. A failed call (invalid JSON
  // or wrong shape) is a retryable failure and must throw so the route returns
  // a 5xx — distinct from a successful parse that legitimately yields no items
  // (handled below, returns an empty array).
  let rawJson;
  try {
    rawJson = JSON.parse(content);
  } catch {
    // "length" means the reply was cut off at max_completion_tokens.
    log.warn(
      { finishReason: response.choices[0]?.finish_reason },
      "food NLP: AI returned invalid JSON",
    );
    throw new Error("Food parsing returned invalid data. Please try again.");
  }
  const parsed = validateAiResponse(rawJson, foodNlpResponseSchema);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("Food parsing returned unexpected data. Please try again.");
  }

  // Look up nutrition for all parsed items in parallel (rate-limited). Look up
  // the food itself — a quantity in the query does not change what CNF/USDA
  // return (per 100 g) and hurts their matching.
  const items = parsed.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    lookupName: validOrUndefined(lookupNameSchema, item.lookupName),
    grams: validOrUndefined(portionGramsSchema, item.grams),
  }));
  const settled = await Promise.allSettled(
    items.map((item) =>
      limit(() => lookupNutrition(item.lookupName ?? item.name)),
    ),
  );

  return items.map((item, i) => {
    const outcome = settled[i];
    const nutrition = outcome.status === "fulfilled" ? outcome.value : null;
    return {
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      ...toPortion(nutrition, item),
    };
  });
}

type PortionNutrition = Pick<
  ParsedFoodItem,
  "calories" | "protein" | "carbs" | "fat" | "servingSize"
>;

/**
 * Convert a lookup result to the portion the user described (see
 * `scaleToGrams` for how the result's basis is read).
 */
function toPortion(
  nutrition: NutritionData | null,
  item: { quantity: number; unit: string; grams?: number },
): PortionNutrition {
  if (!nutrition) {
    return {
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      servingSize: `${item.quantity} ${item.unit}`,
    };
  }

  if (item.grams) {
    const portion = scaleToGrams(nutrition, item.grams);
    if (portion) {
      const grams = Math.round(item.grams);
      return {
        ...macros(portion),
        servingSize: `${item.quantity} ${item.unit} (${grams} g)`,
      };
    }
  } else {
    const per100g = scaleToGrams(nutrition, 100);
    if (per100g) {
      return { ...macros(per100g), servingSize: "100 g (portion unknown)" };
    }
  }

  // A basis we can't weigh ("1 serving"): the values describe that basis, so
  // keep both rather than guess.
  return {
    ...macros(nutrientValues(nutrition)),
    servingSize: nutrition.servingSize || null,
  };
}

function macros(values: NutrientValues): Omit<PortionNutrition, "servingSize"> {
  const { calories, protein, carbs, fat } = values;
  return { calories, protein, carbs, fat };
}
