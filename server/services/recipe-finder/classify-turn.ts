// server/services/recipe-finder/classify-turn.ts
import { aiChat } from "../../lib/ai-client";
import { z } from "zod";
import {
  sanitizeContextField,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
} from "../../lib/ai-safety";
import { createServiceLogger, toError } from "../../lib/logger";

const log = createServiceLogger("recipe-finder-classify-turn");

export type TurnClass = "new_request" | "refine_current" | "other";

/** Runs on every message after a recipe card — keep it short. */
export const CLASSIFY_TURN_TIMEOUT_MS = 6_000;

const responseSchema = z.object({
  class: z.enum(["new_request", "refine_current", "other"]),
});

/** Why the class is the "new_request" fallback; null = the model's answer. */
export type TurnClassFallback = "call_failed" | "empty" | "unparseable" | null;

/**
 * §3.3: after a recipe card, decide whether a message starts a new search,
 * refines the card on screen, or is ordinary chat. Any failure returns
 * "new_request": a list shown by mistake is recoverable (tap Generate, or
 * type again); silently rewriting the user's recipe is not.
 */
export async function classifyTurn(
  message: string,
  currentRecipeTitle: string,
): Promise<TurnClass> {
  return (await classifyTurnDetailed(message, currentRecipeTitle)).class;
}

/**
 * classifyTurn plus WHY it fell back, for callers (the offer probe) that must
 * not count a fallback "new_request" as a measurement.
 */
export async function classifyTurnDetailed(
  message: string,
  currentRecipeTitle: string,
): Promise<{ class: TurnClass; fallback: TurnClassFallback }> {
  const fellBack = (fallback: TurnClassFallback, error?: unknown) => {
    if (error !== undefined) {
      log.warn(
        { err: toError(error) },
        "classifyTurn failed; defaulting to new_request",
      );
    }
    return { class: "new_request" as const, fallback };
  };
  let content: string | null | undefined;
  try {
    const response = await aiChat(
      "finder-classify-turn",
      {
        temperature: 0,
        max_completion_tokens: 20,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `A recipe for "${sanitizeContextField(currentRecipeTitle, 120)}" is on screen. Classify the user's next message.
- "refine_current": change THIS recipe (spicier, swap an ingredient, scale servings, make it vegan, less salt).
- "new_request": ask for a DIFFERENT dish or meal (now a dessert, something with salmon instead, what about breakfast, another recipe).
- "other": anything else (thanks, storage or technique questions about this recipe, small talk).
Return JSON: {"class": "new_request" | "refine_current" | "other"}

${SYSTEM_PROMPT_BOUNDARY}`,
          },
          { role: "user", content: sanitizeContextField(message, 2000) },
        ],
      },
      { timeout: CLASSIFY_TURN_TIMEOUT_MS },
    );
    content = response.choices[0]?.message?.content;
  } catch (error) {
    return fellBack("call_failed", error);
  }
  if (!content) return fellBack("empty");
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    return fellBack("unparseable", error);
  }
  const parsed = validateAiResponse(json, responseSchema);
  return parsed
    ? { class: parsed.class, fallback: null }
    : fellBack("unparseable");
}
