// server/services/notebook-extraction.ts
import { openai, MODEL_FAST } from "../lib/openai";
import { civilDateString } from "../lib/civil-date";
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

// Built per-call (like `buildSystemPrompt` in nutrition-coach.ts) rather than
// a static const, because it must state the CURRENT civil date. Without it,
// the model has nothing to resolve a relative check-in phrase ("next week")
// against, so it either guesses or omits `followUpDate` entirely. Model to
// follow: PR #892's "Current time for this user" line.
//
// This prompt does NOT participate in `getSystemPromptTemplateVersion` /
// `hashCoachCacheKey` (nutrition-coach.ts / coach-pro-chat.ts) — those hash
// only `buildSystemPrompt`'s output. `extractNotebookEntries` makes its own,
// uncached `openai.chat.completions.create` call, so editing this prompt's
// text has no cache-invalidation consequence.
function buildExtractionPrompt(now: Date, tz: string): string {
  return `You are a coaching analyst. Given a conversation between a nutrition coach and a user, extract structured insights.

Current date for this user: ${civilDateString(now, tz)}. Resolve relative phrases ("next week", "in three days", "this weekend") against this date — never guess a date you were not given. The resolved date must be on or after the current date above; if the phrase would resolve to an earlier date, return null instead.

Return a JSON object with an "entries" array. Each entry has:
- type: one of "insight", "commitment", "preference", "goal", "motivation", "emotional_context", "conversation_summary", "coaching_strategy"
- content: a concise description (max 500 chars)
- followUpDate: ISO date string (YYYY-MM-DD) if this is a commitment with a check-in date, resolved against the current date above — otherwise null

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
}

export async function extractNotebookEntries(
  messages: ConversationMessage[],
  userId: string,
  conversationId: number,
  // `tz` is required, not defaulted — a plausible UTC default on a
  // timezone-dependent parameter is exactly what let `followUpDate` get
  // guessed and written at UTC midnight in the first place (see this
  // function's own history). `now` stays optional for testability; the
  // caller (coach-pro-chat.ts) passes the turn-start instant it already
  // captured, so the date anchors to when the user SPOKE rather than a
  // second, later `new Date()` computed after the SSE stream drains — it is
  // not guaranteed to be the identical instant the coach's own system prompt
  // rendered its date from (that is a separate, independently-defaulted
  // `new Date()` in nutrition-coach.ts), just the closer and more correct of
  // the two available anchors.
  { now = new Date(), tz }: { now?: Date; tz: string },
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

    const extractionPrompt = buildExtractionPrompt(now, tz);
    const prompt = includeStrategy
      ? extractionPrompt
      : extractionPrompt +
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

    // Defense-in-depth: the prompt instructs the model to never resolve a
    // relative phrase into the past, but instruction-following isn't
    // guaranteed. Compare CIVIL DAYS AS STRINGS — `yyyy-mm-dd` sorts
    // lexicographically the same as chronologically (civil-date.ts does the
    // same comparison) — never `civilDateToInstant(...) < now`: that would
    // wrongly reject TODAY's date too, since local midnight is before `now`
    // for all but one instant a day. That basis mismatch is the exact bug
    // this whole todo exists to fix, so it must not be reintroduced here.
    //
    // A same-day resolution (`followUpDate === todayStr`) is accepted, not
    // floored to tomorrow — but once anchored via `civilDateToInstant` at
    // write time (coach-pro-chat.ts) it is local midnight, an instant
    // already `<= now`. The notification-scheduler's daily cron has no
    // per-user hour gate, so a "check in with me later today" commitment
    // becomes due on the very next sweep, not literally "later today". This
    // is an accepted, date-granularity limitation (the column stores a day,
    // not a time — a column-type migration is explicitly out of this todo's
    // scope), not a defect this diff introduces: the old naive
    // `new Date(dateStr)` anchor had the identical same-day-is-already-due
    // property for every user, in every zone.
    const todayStr = civilDateString(now, tz);

    return result.data.entries
      .map((e) => {
        if (e.followUpDate && e.followUpDate < todayStr) {
          // Signal prompt drift the same way schema-validation failure
          // above does — if the model starts ignoring the "resolve on or
          // after the current date" instruction, this is the only place
          // that would ever show it.
          logger.warn(
            { conversationId, rejectedFollowUpDate: e.followUpDate, todayStr },
            "Notebook extraction: model resolved followUpDate into the past, discarding",
          );
        }
        return {
          type: e.type,
          content: sanitizeContextField(e.content, 500),
          followUpDate:
            e.followUpDate && e.followUpDate >= todayStr
              ? e.followUpDate
              : null,
        };
      })
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
