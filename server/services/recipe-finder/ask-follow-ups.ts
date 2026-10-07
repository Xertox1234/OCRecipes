// server/services/recipe-finder/ask-follow-ups.ts
import { aiChat } from "../../lib/ai-client";
import { z } from "zod";
import { OPENAI_TIMEOUT_FAST_MS } from "../../lib/openai";
import {
  sanitizeUserInput,
  sanitizeContextField,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
} from "../../lib/ai-safety";
import { createServiceLogger, toError } from "../../lib/logger";
import {
  clarifyingQuestionSchema,
  type ClarifyingQuestion,
  type RecipeDetails,
} from "@shared/schemas/recipe-finder";

const log = createServiceLogger("recipe-finder-follow-ups");

/** Defensive filter: the app already asks these on the adjust card. */
const ALREADY_ASKED = /allerg|serving|spic|how long|time/i;

const responseSchema = z.object({
  questions: z.array(clarifyingQuestionSchema).max(2),
});

/** 0–2 dish-specific follow-up questions. Never throws; [] on any failure. */
export async function askDishFollowUps(
  dish: string,
  details: RecipeDetails,
  transcript: { role: "user" | "assistant"; content: string }[],
): Promise<ClarifyingQuestion[]> {
  try {
    const convo = transcript
      .slice(-6)
      .map((m) =>
        m.role === "user"
          ? `User: ${sanitizeUserInput(m.content).slice(0, 300)}`
          : `Assistant: ${sanitizeContextField(m.content, 300)}`,
      )
      .join("\n");
    const detailLines = [
      details.servings ? `Servings: ${details.servings}` : null,
      details.spice ? `Spice: ${details.spice}` : null,
      details.time ? `Time: ${details.time}` : null,
      details.ingredients.length
        ? `Ingredients mentioned: ${details.ingredients
            .map((i) => sanitizeContextField(i, 60))
            .join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await aiChat(
      "finder-dish-follow-ups",
      {
        temperature: 0,
        max_completion_tokens: 250,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `The user wants a recipe for "${sanitizeContextField(dish, 80)}". Ask 0–2 short multiple-choice questions ONLY about choices that change the recipe and that the conversation leaves open (e.g. protein choice, cooking method, using an ingredient they mentioned). Never ask about allergies, servings, spice level or cooking time — the app already asks those. If nothing is open, return {"questions": []}. Return JSON: {"questions": [{"question": string (max 12 words), "options": [2-4 short answers, max 4 words each]}]}

${SYSTEM_PROMPT_BOUNDARY}`,
          },
          {
            role: "user",
            content: `Recent conversation:\n${convo}\n\nDetails so far:\n${detailLines || "(none)"}`,
          },
        ],
      },
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );
    const content = response.choices[0]?.message?.content;
    if (!content) return [];
    const json: unknown = JSON.parse(content);
    const raw =
      json && typeof json === "object" && "questions" in json
        ? (json as { questions: unknown }).questions
        : undefined;
    if (!Array.isArray(raw)) return [];
    const kept = raw
      .filter(
        (q: unknown) =>
          !(
            q &&
            typeof q === "object" &&
            "question" in q &&
            typeof q.question === "string" &&
            ALREADY_ASKED.test(q.question)
          ),
      )
      .slice(0, 2);
    const parsed = validateAiResponse({ questions: kept }, responseSchema);
    return parsed ? parsed.questions : [];
  } catch (error) {
    log.warn({ err: toError(error) }, "askDishFollowUps failed; no follow-ups");
    return [];
  }
}
