// server/services/notebook-extraction.ts
import { openai, MODEL_FAST } from "../lib/openai";
import {
  extractionResultSchema,
  type NotebookEntryType,
} from "@shared/schemas/coach-notebook";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import {
  containsUnsafeCoachAdvice,
  sanitizeContextField,
  sanitizeUserInput,
  SYSTEM_PROMPT_BOUNDARY,
} from "../lib/ai-safety";

interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const EXTRACTION_PROMPT = `You are a coaching analyst. Given a conversation between a nutrition coach and a user, extract structured insights.

Return a JSON object with an "entries" array. Each entry has:
- type: one of "insight", "commitment", "preference", "goal", "motivation", "emotional_context", "conversation_summary", "coaching_strategy"
- content: a concise description (max 500 chars)
- followUpDate: ISO date string if this is a commitment with a check-in date, otherwise null

Rules:
- Only extract genuinely new information — skip greetings and small talk
- Commitments must be things the user explicitly agreed to try
- Preferences are stated likes/dislikes about food, cooking, or lifestyle
- Goals are explicit targets the user wants to achieve
- Motivations are the deeper "why" behind their goals
- Emotional context captures stress, frustration, or excitement related to nutrition
- Conversation summary should be 1-2 sentences covering what was discussed and decided
- coaching_strategy describes how the user responds best (only include if clear signal)
- Maximum 10 entries per extraction
- Return empty entries array if nothing meaningful to extract

${SYSTEM_PROMPT_BOUNDARY}`;

export async function extractNotebookEntries(
  messages: ConversationMessage[],
  userId: string,
  conversationId: number,
): Promise<
  {
    type: NotebookEntryType;
    content: string;
    followUpDate: string | null;
  }[]
> {
  try {
    const strategyCount = await storage.getNotebookEntryCount(
      userId,
      "coaching_strategy",
    );
    const includeStrategy = shouldUpdateStrategy(strategyCount);

    const prompt = includeStrategy
      ? EXTRACTION_PROMPT
      : EXTRACTION_PROMPT +
        '\n- Do NOT include "coaching_strategy" entries this time.';

    const response = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: "system", content: prompt },
        ...messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            // Sanitize before the extractor sees them so prompt-injection
            // attempts in the chat transcript don't poison what we pull into
            // the notebook (which is later re-injected into the coach
            // system prompt).
            content: sanitizeUserInput(m.content),
          })),
      ],
      response_format: { type: "json_object" },
      max_tokens: 1000,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const result = extractionResultSchema.safeParse(parsed);

    if (!result.success) {
      logger.warn(
        { error: result.error.message, conversationId },
        "Failed to validate extraction result",
      );
      return [];
    }

    return result.data.entries
      .map((e) => ({
        type: e.type,
        content: sanitizeContextField(e.content, 500),
        followUpDate: e.followUpDate ?? null,
      }))
      .filter((entry) => !containsUnsafeCoachAdvice(entry.content));
  } catch (error) {
    logger.error({ error, conversationId }, "Notebook extraction failed");
    return [];
  }
}

export function shouldUpdateStrategy(currentCount: number): boolean {
  // M9 (2026-04-18): count=0 means new user — strategy was never extracted.
  // Original `count > 0 && count % 5 === 0` caused a self-locking gate that
  // prevented new users from ever getting a coaching_strategy entry.
  return currentCount === 0 || currentCount % 5 === 0;
}
