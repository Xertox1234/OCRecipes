// server/services/recipe-finder/ask-clarifying.ts
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
} from "@shared/schemas/recipe-finder";

const log = createServiceLogger("recipe-finder-clarify");

/** §6: askClarifying failure → fixed questions: time, cuisine, diet. */
export const FALLBACK_QUESTIONS: ClarifyingQuestion[] = [
  {
    question: "How much time do you have?",
    options: ["Under 20 minutes", "About 30–45 minutes", "An hour or more"],
  },
  {
    question: "Any cuisine you're in the mood for?",
    options: ["Mediterranean", "Asian", "Mexican", "Italian", "Surprise me"],
  },
  {
    question: "Any diet to follow?",
    options: [
      "No preference",
      "Vegetarian",
      "Vegan",
      "Gluten free",
      "High protein",
    ],
  },
];

const responseSchema = z.object({
  questions: z.array(clarifyingQuestionSchema).min(2).max(3),
});

export async function askClarifying(
  request: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<ClarifyingQuestion[]> {
  const transcript = history
    .slice(-4)
    .map((m) =>
      m.role === "user"
        ? `User: ${sanitizeUserInput(m.content).slice(0, 300)}`
        : `Assistant: ${sanitizeContextField(m.content, 300)}`,
    )
    .join("\n");
  let content: string | null | undefined;
  try {
    const response = await aiChat(
      "finder-ask-clarifying",
      {
        temperature: 0.3,
        max_completion_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `The user asked for a recipe and none of the suggestions fit.
Ask 2 or 3 short multiple-choice questions that would most narrow the search: time available, cuisine, diet, main ingredient, or meal type — whichever the request leaves open.
Return JSON: {"questions": [{"question": string (max 12 words), "options": [2-5 short answers, max 4 words each]}]}
Never ask about allergies (the app already filters them).

${SYSTEM_PROMPT_BOUNDARY}`,
          },
          {
            role: "user",
            content: `Request: ${sanitizeUserInput(request)}\n\nRecent conversation:\n${transcript}`,
          },
        ],
      },
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );
    content = response.choices[0]?.message?.content;
  } catch (error) {
    log.warn(
      { err: toError(error) },
      "askClarifying failed; using fixed questions",
    );
    return FALLBACK_QUESTIONS;
  }
  if (!content) return FALLBACK_QUESTIONS;
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return FALLBACK_QUESTIONS;
  }
  const parsed = validateAiResponse(json, responseSchema);
  return parsed ? parsed.questions : FALLBACK_QUESTIONS;
}
