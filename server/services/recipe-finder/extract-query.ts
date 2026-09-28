// server/services/recipe-finder/extract-query.ts
import { z } from "zod";
import { openai, OPENAI_TIMEOUT_FAST_MS, MODEL_FAST } from "../../lib/openai";
import {
  sanitizeUserInput,
  sanitizeContextField,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
} from "../../lib/ai-safety";
import { createServiceLogger, toError } from "../../lib/logger";
import {
  recipeQuerySchema,
  type RecipeQuery,
} from "@shared/schemas/recipe-finder";

const log = createServiceLogger("recipe-finder-extract-query");

// Lenient on the wire: a bad optional field degrades to "absent" below; only
// a missing/blank q falls back to the raw text.
const aiQuerySchema = z.object({
  q: z.string().optional(),
  cuisine: z.string().nullable().optional(),
  diet: z.string().nullable().optional(),
  maxPrepTime: z.number().nullable().optional(),
  mealType: z.string().nullable().optional(),
});

/** §6: on any extractQuery failure, search the raw text with no filters. */
export function rawQuery(text: string): RecipeQuery {
  const q = sanitizeUserInput(text).trim().slice(0, 200);
  return { q: q || "recipe" };
}

export async function extractQuery(
  text: string,
  context: { dietType?: string | null } = {},
): Promise<RecipeQuery> {
  const sanitized = sanitizeUserInput(text);
  const dietLine = context.dietType
    ? `The user's saved diet type is "${sanitizeContextField(context.dietType, 50)}". Do not add it unless the request mentions a diet.`
    : "";

  let content: string | null | undefined;
  try {
    const response = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
        temperature: 0,
        max_completion_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You turn a recipe request into search terms.
Return JSON: {"q": string, "cuisine": string|null, "diet": string|null, "maxPrepTime": number|null, "mealType": "breakfast"|"lunch"|"dinner"|"snack"|null}
- "q": 1-6 plain words naming the dish or main ingredients (e.g. "chicken curry", "quinoa salad"). No filler words like "recipe", "please", "something".
- "cuisine": only if the user named a cuisine (e.g. "mediterranean", "thai"), else null.
- "diet": one of "vegetarian", "vegan", "gluten free", "dairy free", "ketogenic", "paleo" — only if named, else null.
- "maxPrepTime": minutes, only if the user gave a time limit, else null.
- "mealType": only if named, else null.
${dietLine}

${SYSTEM_PROMPT_BOUNDARY}`,
          },
          { role: "user", content: sanitized },
        ],
      },
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );
    content = response.choices[0]?.message?.content;
  } catch (error) {
    log.warn(
      { err: toError(error) },
      "extractQuery failed; searching raw text",
    );
    return rawQuery(text);
  }
  if (!content) return rawQuery(text);

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return rawQuery(text);
  }
  const ai = validateAiResponse(json, aiQuerySchema);
  const aiQ = ai?.q?.trim();
  if (!ai || !aiQ) return rawQuery(text);

  const q = aiQ.slice(0, 200);
  const optional = {
    cuisine: ai.cuisine ?? undefined,
    diet: ai.diet ?? undefined,
    maxPrepTime: ai.maxPrepTime ?? undefined,
    mealType: ai.mealType ?? undefined,
  };
  // Keep each optional field only if it validates on its own.
  const result: RecipeQuery = { q };
  for (const key of Object.keys(optional) as (keyof typeof optional)[]) {
    const value = optional[key];
    if (value === undefined) continue;
    const parsed = recipeQuerySchema.shape[key].safeParse(value);
    if (parsed.success && parsed.data !== undefined) {
      (result as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return result;
}
