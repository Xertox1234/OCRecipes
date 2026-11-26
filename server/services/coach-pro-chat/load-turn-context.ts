import { storage } from "../../storage";
import type { CoachContext } from "../coach-prompt";
import { assembleCoachContext } from "../coach-context-builder";
import { consumeWarmUp } from "../coach-warm-up";
import {
  getDayBucketInTz,
  hashCoachCacheContext,
  hashCoachCacheKey,
} from "../coach-cache-keys";
import { containsUnsafeCoachAdvice } from "../../lib/ai-safety";
import {
  truncateHistoryToBudget,
  DEFAULT_HISTORY_TOKEN_BUDGET,
} from "../../lib/chat-history-truncate";
import { isOpeningBriefMessage } from "@shared/lib/opening-brief";
import type { ChatMessage } from "@shared/schema";
import type { CoachIntent } from "../coach-intent-classifier";
import { applyWriteCardContext } from "./write-card-context";
import { proOnly } from "./pro-only";
import type { CoachChatParams } from "./types";
import { logger } from "../../lib/logger";

export interface PromptMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

function isPromptRole(role: string): role is PromptMessage["role"] {
  return role === "user" || role === "assistant" || role === "system";
}

/** Everything the reply stage needs, read once at the top of the turn. */
export interface TurnContext {
  /** Turn-start instant. */
  today: Date;
  tz: string;
  profile: Awaited<ReturnType<typeof storage.getUserProfile>>;
  /** The DB history (includes this turn's user row). */
  history: ChatMessage[];
  notebookEntries: Awaited<ReturnType<typeof storage.getActiveNotebookEntries>>;
  context: CoachContext;
  messageHistory: PromptMessage[];
  /** Non-opening-brief rows in `history`; ≤ 1 means the first user turn. */
  turnCount: number;
  questionHash: string | null;
  /** A cached free-tier reply that passed the live safety screen, else null. */
  cachedResponse: string | null;
}

/**
 * Loads storage, builds the prompt context, applies the warm-up and token
 * budget, and checks the free-tier response cache. Coach Pro reads extra
 * domains; the free tier gets their empty values.
 */
export async function loadTurnContext(
  params: CoachChatParams,
  a: {
    writeCards: boolean;
    intent: CoachIntent;
    /** History the finder gate already read, if any. */
    finderHistory?: ChatMessage[];
  },
): Promise<TurnContext> {
  const {
    conversationId,
    userId,
    content,
    screenContext,
    warmUpId,
    isCoachPro,
    tz = "UTC",
    user,
    liveCard,
  } = params;

  const today = new Date();

  // For Coach Pro, also fetch 7 days of daily logs to derive meal patterns.
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  // 30-day window for the frequent-foods aggregate — stabler counts than 7d.
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    profile,
    dailySummary,
    history,
    recentLogsForPatterns,
    notebookEntries,
    dueCommitments,
    frequentFoods,
  ] = await Promise.all([
    storage.getUserProfile(userId),
    storage.getDailySummary(userId, today, tz),
    a.finderHistory ?? storage.getChatMessages(conversationId, 20, userId),
    proOnly(
      isCoachPro,
      () => storage.getDailyLogsInRange(userId, sevenDaysAgo, today),
      [],
    ),
    proOnly(isCoachPro, () => storage.getActiveNotebookEntries(userId), []),
    proOnly(
      isCoachPro,
      () => storage.getCommitmentsWithDueFollowUp(userId),
      [],
    ),
    proOnly(
      isCoachPro,
      () => storage.getMostEatenFoods(userId, thirtyDaysAgo, today),
      [],
    ),
  ]);

  const context = assembleCoachContext({
    isCoachPro,
    user,
    tz,
    screenContext,
    profile,
    dailySummary,
    recentLogsForPatterns,
    notebookEntries,
    dueCommitments,
    frequentFoods,
  });

  if (a.writeCards) {
    await applyWriteCardContext(context, { conversationId, userId, liveCard });
  }

  // role is a free text column: drop a row with any other value rather than
  // cast it into the model call (audit 2026-11-24, L48; same as warm-up).
  let messageHistory: PromptMessage[] = history.flatMap((m) => {
    if (!isPromptRole(m.role)) {
      logger.warn(
        { messageId: m.id, role: m.role },
        "coach turn: dropping history row with unexpected role",
      );
      return [];
    }
    return [{ role: m.role, content: m.content }];
  });

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
  // The saved opening brief (an assistant row written before the first user
  // message) doesn't make this a later turn — not for the free cache, not
  // for the auto-title below.
  const turnCount = history.filter((m) => !isOpeningBriefMessage(m)).length;
  const isCacheable = !screenContext && turnCount <= 1 && !isCoachPro;
  const questionHash = isCacheable
    ? hashCoachCacheKey(
        userId,
        content,
        isCoachPro,
        getDayBucketInTz(today, tz),
        hashCoachCacheContext(context, today, tz),
        a.intent,
      )
    : null;

  let cachedResponse: string | null = null;
  if (questionHash) {
    cachedResponse = await storage.getCoachCachedResponse(userId, questionHash);
  }

  // M6 (2026-04-18): Re-scan cached responses with the live output screen
  // (dietary and medical — the same check a fresh reply gets) before serving.
  // A response may have been cached before the safety filter existed, or
  // safety thresholds may have been tightened since it was stored. Discarding
  // the entry forces a fresh generation that goes through the live checks.
  if (cachedResponse && containsUnsafeCoachAdvice(cachedResponse)) {
    cachedResponse = null;
  }

  return {
    today,
    tz,
    profile,
    history,
    notebookEntries,
    context,
    messageHistory,
    turnCount,
    questionHash,
    cachedResponse,
  };
}
