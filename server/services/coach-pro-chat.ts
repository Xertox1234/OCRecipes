/**
 * Coach Pro Chat Service
 *
 * Orchestrates the Coach chat path (both standard and Pro):
 *   - Context building from multiple storage domains
 *   - Notebook injection (Pro)
 *   - Warm-up consumption (Pro)
 *   - Response caching
 *   - Block parsing (Pro)
 *   - Message persistence
 *   - Auto-titling
 *   - Notebook extraction (Pro)
 *
 * Extracted from server/routes/chat.ts to keep route handlers thin.
 */

import { createHash } from "crypto";
import { storage } from "../storage";
import {
  generateCoachResponse,
  generateCoachProResponse,
  getSystemPromptTemplateVersion,
  type CoachContext,
} from "./nutrition-coach";
import { parseBlocksFromContent, BLOCKS_SYSTEM_PROMPT } from "./coach-blocks";
import { extractNotebookEntries } from "./notebook-extraction";
import {
  sanitizeContextField,
  containsDangerousDietaryAdvice,
} from "../lib/ai-safety";
import { fireAndForget } from "../lib/fire-and-forget";
import { consumeWarmUp } from "./coach-warm-up";
import { calculateWeeklyRate } from "./weight-trend";
import {
  truncateNotebookToBudget,
  DEFAULT_NOTEBOOK_MAX_CHARS,
} from "./notebook-budget";
import {
  truncateHistoryToBudget,
  DEFAULT_HISTORY_TOKEN_BUDGET,
} from "../lib/chat-history-truncate";
import type { DailyLog } from "@shared/schema";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

/**
 * Derive a short meal-pattern summary from 7 days of daily logs.
 *
 * Exported for unit testing — all inputs are pure values, no storage calls.
 *
 * Detection logic (based on `loggedAt` hour, local time):
 *  - Breakfast window: 05:00–10:59
 *  - Lunch window:     11:00–14:59
 *  - Dinner window:    15:00–20:59
 *  - Late-night:       21:00–04:59 (hour >= 21 || hour < 5)
 *
 * A meal is considered "skipped" on a given day when there are zero log entries
 * in its window AND at least one entry exists on that day (i.e. the user was
 * actively logging, they just didn't eat in that window). Days with zero total
 * entries are excluded — we can't distinguish "skipped" from "didn't log".
 *
 * Returns `null` when the dataset has fewer than 3 active-logging days (not
 * enough signal). The caller is responsible for pre-filtering logs to the
 * desired time window (e.g. last 7 days) before passing them in.
 */
export function buildMealPatternSummary(
  logs: Pick<DailyLog, "loggedAt">[],
): string | null {
  if (logs.length === 0) return null;

  // Group logs by calendar day (YYYY-MM-DD in local time)
  const byDay = new Map<string, Date[]>();
  for (const log of logs) {
    const date = new Date(log.loggedAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const existing = byDay.get(key);
    if (existing) {
      existing.push(date);
    } else {
      byDay.set(key, [date]);
    }
  }

  // Only consider days with at least one log entry
  const activeDays = Array.from(byDay.values());
  if (activeDays.length < 3) return null;

  const totalDays = activeDays.length;

  const inBreakfast = (h: number) => h >= 5 && h < 11;
  const inLunch = (h: number) => h >= 11 && h < 15;
  const inDinner = (h: number) => h >= 15 && h < 21;
  const isLateNight = (h: number) => h >= 21 || h < 5;

  let skippedBreakfast = 0;
  let skippedLunch = 0;
  let skippedDinner = 0;
  let lateNightDays = 0;

  for (const dayLogs of activeDays) {
    const hours = dayLogs.map((d) => d.getHours());
    if (!hours.some(inBreakfast)) skippedBreakfast++;
    if (!hours.some(inLunch)) skippedLunch++;
    if (!hours.some(inDinner)) skippedDinner++;
    if (hours.some(isLateNight)) lateNightDays++;
  }

  const patterns: string[] = [];

  // Only surface patterns that are notable (skipped on majority of days)
  const majorityThreshold = Math.ceil(totalDays / 2);
  if (skippedBreakfast >= majorityThreshold) {
    patterns.push(`breakfast skipped ${skippedBreakfast}/${totalDays} days`);
  }
  if (skippedLunch >= majorityThreshold) {
    patterns.push(`lunch skipped ${skippedLunch}/${totalDays} days`);
  }
  if (skippedDinner >= majorityThreshold) {
    patterns.push(`dinner skipped ${skippedDinner}/${totalDays} days`);
  }
  if (lateNightDays >= majorityThreshold) {
    patterns.push(`late-night eating on ${lateNightDays}/${totalDays} days`);
  }

  if (patterns.length === 0) return null;
  return patterns.join("; ");
}

/** SSE event yielded by the coach chat service. */
export type CoachChatEvent =
  | { type: "content"; content: string }
  | { type: "blocks"; blocks: CoachBlock[] };

export interface CoachChatParams {
  conversationId: number;
  userId: string;
  content: string;
  screenContext?: string;
  warmUpId?: string;
  isCoachPro: boolean;
  user: {
    dailyCalorieGoal: number | null;
    dailyProteinGoal: number | null;
    dailyCarbsGoal: number | null;
    dailyFatGoal: number | null;
  };
  /** Called each iteration to check if the client disconnected. */
  isAborted: () => boolean;
  /**
   * AbortSignal wired to the HTTP close event. Passed to the OpenAI SDK so
   * in-flight generation is cancelled when the client disconnects, stopping
   * token consumption immediately. (M8 — 2026-04-18)
   */
  abortSignal?: AbortSignal;
}

/** UTC day bucket — e.g. `"2026-04-18"`. Used to expire cached coach answers
 *  whose prompt includes today's numeric context (goals, intake, weight). */
function getUtcDayBucket(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build the SHA-256 cache key used for coach-response caching. The key includes:
 *  - prompt template version — automatically derived from the static system
 *    prompt hash so cache entries stale out when the prompt prose changes,
 *    eliminating the need for a manual version bump (H5 — 2026-04-18)
 *  - userId  — different users must not share answers
 *  - isCoachPro — Pro and non-Pro prompts diverge (tools, notebook); a cached
 *    non-Pro answer must never be replayed to a Pro user (H4 — 2026-04-18)
 *  - dayBucket — keeps universal first-turn answers from crossing UTC days
 *  - contextHash — captures goals, intake, weight trend, dietary profile, and
 *    hour bucket so same-day context changes invalidate cached answers
 */
export function hashCoachCacheKey(
  userId: string,
  content: string,
  isCoachPro: boolean,
  dayBucket: string = getUtcDayBucket(),
  contextHash = "no-context",
): string {
  return createHash("sha256")
    .update(
      [
        getSystemPromptTemplateVersion(),
        userId,
        isCoachPro ? "pro" : "free",
        dayBucket,
        contextHash,
        content.trim().toLowerCase(),
      ].join("\u001f"),
    )
    .digest("hex")
    .slice(0, 32);
}

export function hashCoachCacheContext(
  context: CoachContext,
  now: Date = new Date(),
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        goals: context.goals,
        todayIntake: context.todayIntake,
        weightTrend: context.weightTrend,
        dietaryProfile: context.dietaryProfile,
        hour: now.getHours(),
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * Build a dedup fingerprint for a notebook write. The same conversation
 * turn (same last user + last assistant pair) must always produce the same
 * key so the unique index makes repeat writes idempotent.
 *
 * For `coaching_strategy` entries the key is bucketed by ISO week instead
 * of conversation turn so the TOCTOU between `shouldUpdateStrategy`'s count
 * read and the insert cannot produce duplicate strategy rows for the same
 * user in the same week.
 */
export function hashNotebookDedupeKey(params: {
  userId: string;
  conversationId: number;
  entryType: string;
  entryContent: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
}): string {
  if (params.entryType === "coaching_strategy") {
    const weekBucket = getIsoWeekBucket(new Date());
    return createHash("sha256")
      .update(["coaching_strategy", params.userId, weekBucket].join("\u001f"))
      .digest("hex");
  }
  return createHash("sha256")
    .update(
      [
        params.userId,
        String(params.conversationId),
        params.entryType,
        params.entryContent,
        params.lastUserMessage,
        params.lastAssistantMessage,
      ].join("\u001f"),
    )
    .digest("hex");
}

/** Returns an ISO year+week bucket string like `"2026-W16"`. */
function getIsoWeekBucket(d: Date): string {
  // Copy to UTC and shift to the nearest Thursday (ISO week anchor).
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * In-memory record of the last time we attempted `archiveOldEntries` for a
 * given user. Bounded by an LRU eviction so long-running processes do not
 * grow this map indefinitely.
 */
const ARCHIVE_THROTTLE_MS = 24 * 60 * 60 * 1000; // once per day per user
const lastArchivedAt = new Map<string, number>();
const LAST_ARCHIVED_MAX_ENTRIES = 10_000;

function shouldRunArchive(userId: string, now: number): boolean {
  const prev = lastArchivedAt.get(userId);
  if (prev && now - prev < ARCHIVE_THROTTLE_MS) return false;
  // Simple bound: if we hit capacity, drop the oldest insertion.
  if (
    lastArchivedAt.size >= LAST_ARCHIVED_MAX_ENTRIES &&
    !lastArchivedAt.has(userId)
  ) {
    const firstKey = lastArchivedAt.keys().next().value;
    if (firstKey !== undefined) lastArchivedAt.delete(firstKey);
  }
  lastArchivedAt.set(userId, now);
  return true;
}

/** Test-only internals — never import from production code. */
export const _testInternals = {
  lastArchivedAt,
  ARCHIVE_THROTTLE_MS,
  shouldRunArchive,
};

/**
 * Run notebook archival for a user if the per-user throttle allows it.
 * Safe to call from any frequent handler — the in-memory throttle gates
 * it to once per 24h per user.
 */
export async function tryArchiveNotebook(userId: string): Promise<void> {
  if (!shouldRunArchive(`open:${userId}`, Date.now())) return;
  await storage.archiveOldEntries(userId, 30);
}

/**
 * Orchestrates the coach chat response — yields SSE events for the route
 * handler to write, handles persistence and side-effects internally.
 */
export async function* handleCoachChat(
  params: CoachChatParams,
): AsyncGenerator<CoachChatEvent> {
  const {
    conversationId,
    userId,
    content,
    screenContext,
    warmUpId,
    isCoachPro,
    user,
    isAborted,
    abortSignal,
  } = params;

  const today = new Date();

  // For Coach Pro, also fetch 7 days of daily logs to derive meal patterns.
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [profile, dailySummary, recentWeights, history, recentLogsForPatterns] =
    await Promise.all([
      storage.getUserProfile(userId),
      storage.getDailySummary(userId, today),
      storage.getWeightLogs(userId, { limit: 14 }),
      storage.getChatMessages(conversationId, 20, userId),
      isCoachPro
        ? storage.getDailyLogsInRange(userId, sevenDaysAgo, today)
        : Promise.resolve(
            [] as Awaited<ReturnType<typeof storage.getDailyLogsInRange>>,
          ),
    ]);

  // Weekly rate of change — shared pure helper so this logic is unit-tested
  // in isolation rather than through the full orchestrator.
  const latestWeight = recentWeights[0] ?? undefined;
  const weeklyRate = calculateWeeklyRate(recentWeights);

  const context: CoachContext = {
    goals: user.dailyCalorieGoal
      ? {
          calories: user.dailyCalorieGoal,
          protein: user.dailyProteinGoal || 0,
          carbs: user.dailyCarbsGoal || 0,
          fat: user.dailyFatGoal || 0,
        }
      : null,
    todayIntake: {
      calories: Number(dailySummary.totalCalories),
      protein: Number(dailySummary.totalProtein),
      carbs: Number(dailySummary.totalCarbs),
      fat: Number(dailySummary.totalFat),
    },
    weightTrend: {
      currentWeight: latestWeight ? parseFloat(latestWeight.weight) : null,
      weeklyRate,
    },
    dietaryProfile: {
      dietType: profile?.dietType || null,
      // Sanitize at the context boundary (M40 — 2026-04-18) so both the prompt
      // builder and any future consumers see clean values.
      allergies: (profile?.allergies || [])
        .map((a) => a?.name)
        .filter(Boolean)
        .map((name) => sanitizeContextField(name, 100)),
      dislikes: ((profile?.foodDislikes as string[]) || []).map((d) =>
        sanitizeContextField(d, 100),
      ),
    },
    screenContext,
  };

  // ── Coach Pro: meal pattern summary ────────────────
  if (isCoachPro && recentLogsForPatterns.length > 0) {
    const mealPatternSummary = buildMealPatternSummary(recentLogsForPatterns);
    if (mealPatternSummary) {
      context.mealPatternSummary = mealPatternSummary;
    }
  }

  // ── Coach Pro: inject notebook context ──────────────
  if (isCoachPro) {
    const notebookEntries = await storage.getActiveNotebookEntries(userId);
    if (notebookEntries.length > 0) {
      // Include updatedAt so the budget formatter can attach recency labels
      // (recent/this week/this month/older), helping the model weight newer
      // entries more prominently in its reasoning.
      const sanitized = notebookEntries.map((e) => ({
        type: e.type,
        content: sanitizeContextField(e.content, 500),
        updatedAt: e.updatedAt,
      }));
      const joined = truncateNotebookToBudget(
        sanitized,
        DEFAULT_NOTEBOOK_MAX_CHARS,
      );
      // Delimiter block frames the (untrusted) notebook content inside the
      // system prompt so the model treats it as data, not instructions.
      context.notebookSummary =
        joined.length > 0
          ? `${joined}\n\n${BLOCKS_SYSTEM_PROMPT}`
          : BLOCKS_SYSTEM_PROMPT;
    } else {
      context.notebookSummary = BLOCKS_SYSTEM_PROMPT;
    }
  }

  let messageHistory: {
    role: "user" | "assistant" | "system";
    content: string;
  }[] = history.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  // ── Coach Pro: consume warm-up if available ─────────
  if (isCoachPro && warmUpId) {
    const warmedUp = consumeWarmUp(userId, conversationId, warmUpId);
    if (warmedUp) {
      // Warm-up already has conversation history — use it
      // The last message in warmedUp is the interim transcript;
      // replace it with the final transcript
      warmedUp[warmedUp.length - 1] = {
        role: "user",
        content,
      };
      messageHistory = warmedUp;
    }
  }

  // ── Token-budget truncation (both DB history and warm-up paths) ──
  // Drop oldest tool-result messages first, then oldest assistant messages,
  // to keep total history under the budget. The last user message is always
  // preserved. Applied after warm-up substitution so both paths are covered.
  messageHistory = truncateHistoryToBudget(
    messageHistory,
    DEFAULT_HISTORY_TOKEN_BUDGET,
  );

  // Check cache for predefined questions (no screenContext = universal answer).
  // Pro responses are excluded because they inject a per-user notebook and
  // reference tool-call results — caching them would serve stale context to
  // the same user (and the cache key is too coarse to distinguish Pro vs
  // non-Pro prompts across users). See H4 — 2026-04-18.
  const isCacheable = !screenContext && history.length <= 1 && !isCoachPro;
  const questionHash = isCacheable
    ? hashCoachCacheKey(
        userId,
        content,
        isCoachPro,
        getUtcDayBucket(today),
        hashCoachCacheContext(context, today),
      )
    : null;

  let cachedResponse: string | null = null;
  if (questionHash) {
    cachedResponse = await storage.getCoachCachedResponse(userId, questionHash);
  }

  // M6 (2026-04-18): Re-scan cached responses for dangerous dietary advice before
  // serving. A response may have been cached before the safety filter existed, or
  // safety thresholds may have been tightened since it was stored. Discarding the
  // entry forces a fresh generation that goes through the live safety checks.
  if (cachedResponse && containsDangerousDietaryAdvice(cachedResponse)) {
    cachedResponse = null;
  }

  let fullResponse = "";

  if (cachedResponse) {
    // Send cached response in 3 chunks with minimal delay
    const len = cachedResponse.length;
    const third = Math.ceil(len / 3);
    const chunks = [
      cachedResponse.slice(0, third),
      cachedResponse.slice(third, third * 2),
      cachedResponse.slice(third * 2),
    ].filter((c) => c.length > 0);
    for (let ci = 0; ci < chunks.length && !isAborted(); ci++) {
      fullResponse += chunks[ci];
      yield { type: "content", content: chunks[ci] };
      if (ci < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 15));
      }
    }
  } else if (isCoachPro) {
    for await (const chunk of generateCoachProResponse(
      messageHistory,
      context,
      userId,
      abortSignal,
    )) {
      if (isAborted()) break;
      fullResponse += chunk;
      yield { type: "content", content: chunk };
    }
  } else {
    for await (const chunk of generateCoachResponse(
      messageHistory,
      context,
      abortSignal,
    )) {
      if (isAborted()) break;
      fullResponse += chunk;
      yield { type: "content", content: chunk };
    }

    if (questionHash && fullResponse && !isAborted()) {
      fireAndForget(
        "coach-cache-response",
        storage.setCoachCachedResponse(
          userId,
          questionHash,
          content,
          fullResponse,
        ),
      );
    }
  }

  // Parse blocks from response for Coach Pro
  let blocks: CoachBlock[] = [];
  let textContent = fullResponse;
  if (isCoachPro && fullResponse) {
    const parsedBlocks = parseBlocksFromContent(fullResponse);
    textContent = parsedBlocks.text;
    blocks = parsedBlocks.blocks;
  }

  if (fullResponse && !isAborted()) {
    await storage.createChatMessage(
      conversationId,
      userId,
      "assistant",
      textContent,
      blocks.length > 0 ? { blocks } : null,
    );
  }

  if (!isAborted() && history.length <= 1) {
    const shortTitle =
      content.slice(0, 50) + (content.length > 50 ? "..." : "");
    fireAndForget(
      "coach-chat-auto-title",
      storage.updateChatConversationTitle(conversationId, userId, shortTitle),
    );
  }

  // Send blocks in the final event for Coach Pro
  if (!isAborted() && blocks.length > 0) {
    yield { type: "blocks", blocks };
  }

  // Fire-and-forget notebook extraction + archival for Coach Pro
  if (isCoachPro && fullResponse && !isAborted()) {
    fireAndForget(
      "coach-notebook-extraction",
      (async () => {
        const allMessages = [
          ...messageHistory,
          { role: "user" as const, content },
          { role: "assistant" as const, content: textContent },
        ];
        const entries = await extractNotebookEntries(
          allMessages,
          userId,
          conversationId,
        );
        if (entries.length > 0) {
          // Build a per-entry dedup fingerprint so SSE retries that replay
          // the same conversation turn do not create duplicate rows. The
          // unique index on `dedupeKey` combined with `onConflictDoNothing`
          // at the storage layer is what actually enforces this.
          await storage.createNotebookEntries(
            entries.map((e) => ({
              userId,
              type: e.type,
              content: e.content,
              status: "active",
              followUpDate: e.followUpDate ? new Date(e.followUpDate) : null,
              sourceConversationId: conversationId,
              dedupeKey: hashNotebookDedupeKey({
                userId,
                conversationId,
                entryType: e.type,
                entryContent: e.content,
                lastUserMessage: content,
                lastAssistantMessage: textContent,
              }),
            })),
          );
        }
        // Archive notebook entries older than 30 days to bound growth.
        // Time-gated to once per day per user so we do not hammer the DB
        // on every assistant turn.
        if (shouldRunArchive(userId, Date.now())) {
          await storage.archiveOldEntries(userId, 30);
        }
      })(),
    );
  }
}
