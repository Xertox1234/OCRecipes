// server/services/recipe-finder/extract-query.ts
import { aiChat } from "../../lib/ai-client";
import { z } from "zod";
import { OPENAI_TIMEOUT_FAST_MS } from "../../lib/openai";
import {
  sanitizeUserInput,
  sanitizeContextField,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
} from "../../lib/ai-safety";
import { parseDish } from "./offer";
import { createServiceLogger, toError } from "../../lib/logger";
import type { ChatMessage } from "@shared/schema";
import {
  recipeDetailsSchema,
  cookingTimeSchema,
  spiceLevelSchema,
  recipeQuerySchema,
  type RecipeDetails,
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
  // sanitizeContextField also strips zero-width/bidi chars (user text here).
  const sanitized = sanitizeContextField(text, 2000);
  const dietLine = context.dietType
    ? `The user's saved diet type is "${sanitizeContextField(context.dietType, 50)}". Do not add it unless the request mentions a diet.`
    : "";

  let content: string | null | undefined;
  try {
    const response = await aiChat(
      "finder-extract-query",
      {
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

const aiOfferSchema = z.object({
  dish: z.unknown().optional(),
  servings: z.unknown().optional(),
  spice: z.unknown().optional(),
  time: z.unknown().optional(),
  ingredients: z.unknown().optional(),
});

/**
 * Coach/RecipeChef typed text -> offer. Never throws: any failure yields
 * `dish: null` (the caller asks which dish).
 */
export async function extractOfferDetails(
  text: string,
  history: ChatMessage[],
): Promise<{ dish: string | null; details: RecipeDetails }> {
  const failed = () => ({
    dish: null,
    details: { ingredients: [], fromConversation: false } as RecipeDetails,
  });
  try {
    const convo = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${sanitizeContextField(m.content, 300)}`,
      )
      .join("\n");
    const response = await aiChat(
      "finder-extract-offer",
      {
        temperature: 0,
        max_completion_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You extract a recipe request from the user's latest message, using the recent conversation only to resolve references like "that" or "make it for 8".
Return JSON: {"dish": string|null, "servings": integer|null, "spice": "mild"|"medium"|"hot"|null, "time": "quick"|"moderate"|"leisurely"|null, "ingredients": string[]}
- "dish": the specific dish the user wants a recipe for, or null if the latest message names no dish (e.g. "thanks").
- "servings", "spice", "time": only if the user stated them, else null.
- "ingredients": ingredients the user asked to use, else [].

${SYSTEM_PROMPT_BOUNDARY}`,
          },
          {
            role: "user",
            content: `Recent conversation:\n${convo || "(none)"}\n\nLatest message: ${sanitizeContextField(text, 2000)}`,
          },
        ],
      },
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );
    const content = response.choices[0]?.message?.content;
    if (!content) return failed();
    const ai = validateAiResponse(JSON.parse(content), aiOfferSchema);
    const dish = ai ? parseDish(ai.dish) : null;
    if (!ai || !dish) return failed();

    const details: RecipeDetails = { ingredients: [], fromConversation: false };
    const servings = recipeDetailsSchema.shape.servings.safeParse(
      ai.servings ?? undefined,
    );
    if (servings.success && servings.data !== undefined) {
      details.servings = servings.data;
    }
    const spice = spiceLevelSchema.safeParse(ai.spice);
    if (spice.success) details.spice = spice.data;
    const time = cookingTimeSchema.safeParse(ai.time);
    if (time.success) details.time = time.data;
    if (Array.isArray(ai.ingredients)) {
      const parsed = recipeDetailsSchema.shape.ingredients.safeParse(
        ai.ingredients
          .filter((i): i is string => typeof i === "string")
          .map((i) => sanitizeContextField(i, 60))
          .filter((i) => i.length > 0)
          .slice(0, 15),
      );
      if (parsed.success) details.ingredients = parsed.data;
    }
    return { dish, details };
  } catch (error) {
    log.warn({ err: toError(error) }, "extractOfferDetails failed; no dish");
    return failed();
  }
}
