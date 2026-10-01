// server/services/recipe-finder/classify-turn.ts
import { z } from "zod";
import { openai, MODEL_FAST } from "../../lib/openai";
import {
  sanitizeUserInput,
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
  try {
    const response = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
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
          { role: "user", content: sanitizeUserInput(message) },
        ],
      },
      { timeout: CLASSIFY_TURN_TIMEOUT_MS },
    );
    const content = response.choices[0]?.message?.content;
    if (!content) return "new_request";
    const parsed = validateAiResponse(JSON.parse(content), responseSchema);
    return parsed ? parsed.class : "new_request";
  } catch (error) {
    log.warn(
      { err: toError(error) },
      "classifyTurn failed; defaulting to new_request",
    );
    return "new_request";
  }
}
