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

import { randomUUID } from "crypto";
import { civilDateToInstant } from "../lib/civil-date";
import { storage } from "../storage";
import {
  generateCoachResponse,
  generateCoachProResponse,
  getSystemPromptTemplateVersion,
  SAFETY_OVERRIDE_SENTINEL,
} from "./nutrition-coach";
import { classifyIntent, type CoachIntent } from "./coach-intent-classifier";
import { parseBlocksFromContent } from "./coach-blocks";
import { extractNotebookEntries } from "./notebook-extraction";
import { containsDangerousDietaryAdvice } from "../lib/ai-safety";
import { fireAndForget } from "../lib/fire-and-forget";
import { createServiceLogger } from "../lib/logger";
import { consumeWarmUp } from "./coach-warm-up";
import {
  assembleCoachContext,
  buildMealPatternSummary,
  type CoachChatUser,
} from "./coach-context-builder";
import {
  getDayBucketInTz,
  hashCoachCacheContext,
  hashCoachCacheKey,
  hashNotebookDedupeKey,
} from "./coach-cache-keys";
import {
  truncateHistoryToBudget,
  DEFAULT_HISTORY_TOKEN_BUDGET,
} from "../lib/chat-history-truncate";
import type { ChatMessage } from "@shared/schema";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import type { FinderAction } from "@shared/schemas/recipe-finder";
import {
  classifyTurn,
  decideCoachFinderEntry,
  getLatestFinderBlock,
  isRecipeOfferEnabled,
  type FinderFeatures,
} from "./recipe-finder";
import {
  runCoachFinderTurn,
  savedBlocks,
  withLead,
  type CoachFinderTurnEntry,
} from "./recipe-finder/coach-turn";
import { buildOfferBlock, decideOfferToolCall } from "./recipe-finder/offer";
import { OFFER_TEXT, finderFallbackText } from "./recipe-finder/fallback-text";

const log = createServiceLogger("coach-pro-chat");

// Re-exported so existing importers (tests) keep their import path.
export {
  hashCoachCacheContext,
  hashCoachCacheKey,
  hashNotebookDedupeKey,
  buildMealPatternSummary,
};

/** SSE event yielded by the coach chat service. */
export type CoachChatEvent =
  | { type: "content"; content: string }
  | { type: "blocks"; blocks: CoachBlock[] }
  | { type: "status"; label: string }
  | { type: "safety_override"; message: string };

export const STANDARD_SAFETY_MESSAGE =
  "I need to be careful here. I can't provide unsafe diet instructions or diagnose medical conditions. Please consult a registered dietitian or healthcare provider who can assess your individual needs.";

const TOOL_STATUS_LABELS: Record<string, string> = {
  lookup_nutrition: "Looking up nutrition…",
  search_recipes: "Searching recipes…",
  get_daily_log_details: "Checking today's log…",
  log_food_item: "Logging food…",
  get_pantry_items: "Checking your pantry…",
  get_meal_plan: "Checking your meal plan…",
  add_to_meal_plan: "Planning your meals…",
  add_to_grocery_list: "Updating grocery list…",
  get_substitutions: "Finding substitutes…",
};

function getToolStatusLabel(toolName: string): string {
  return TOOL_STATUS_LABELS[toolName] ?? "Working on it…";
}

export interface CoachChatParams {
  conversationId: number;
  userId: string;
  content: string;
  screenContext?: string;
  warmUpId?: string;
  isCoachPro: boolean;
  turnKey?: string;
  user: CoachChatUser;
  /** Called each iteration to check if the client disconnected. */
  isAborted: () => boolean;
  /**
   * AbortSignal wired to the HTTP close event. Passed to the OpenAI SDK so
   * in-flight generation is cancelled when the client disconnects, stopping
   * token consumption immediately. (M8 — 2026-04-18)
   */
  abortSignal?: AbortSignal;
  /** IANA timezone of the requesting user, e.g. "America/Los_Angeles". Defaults to UTC. */
  tz?: string;
  /**
   * Recipe finder (spec 2026-09-28). The route passes this ONLY when
   * RECIPE_FINDER_ENABLED is on and the user is Coach Pro; absent → today's
   * behavior exactly.
   */
  finder?: {
    action?: FinderAction;
    /** This turn's user row — Generate/Spoonacular claims mark it. */
    userMessageId: number;
    features: FinderFeatures;
  };
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
 * Persists the assistant reply once per turnKey (SSE retries replay turns).
 * Returns the already-saved row on a turnKey hit, else undefined.
 */
async function persistCoachReply(
  conversationId: number,
  userId: string,
  turnKey: string | undefined,
  text: string,
  metadata: Record<string, unknown> | null,
): Promise<ChatMessage | undefined> {
  if (turnKey) {
    const existing = await storage.getChatMessageByTurnKey(
      conversationId,
      turnKey,
    );
    if (existing) {
      log.info(
        { turnKey },
        "assistant message already persisted, skipping duplicate write",
      );
      return existing;
    }
    await storage.createChatMessage(
      conversationId,
      userId,
      "assistant",
      text,
      metadata,
      turnKey,
    );
  } else {
    await storage.createChatMessage(
      conversationId,
      userId,
      "assistant",
      text,
      metadata,
    );
  }
}

const NO_DISH_TEXT = "Which dish did you have in mind?";

/**
 * Delivers an `offer_recipe` terminal tool call (spec §4.2, H4). Every reply
 * is SAVED (with the turnKey) BEFORE it is yielded: the route stops iterating
 * at a yield once the client leaves, and its H6 settle keeps the user row only
 * if it finds the saved turnKey row. Any streamed pre-tool text (and its
 * blocks) leads the saved offer, re-posted card or adjust card. Returns false
 * only for invalid args after streamed text — that text stands and the
 * caller's normal save path runs.
 */
async function* deliverOfferToolCall(a: {
  params: CoachChatParams;
  finder: NonNullable<CoachChatParams["finder"]>;
  rawArgs: string;
  /** Includes this turn's user row. */
  history: ChatMessage[];
  /** Streamed pre-tool text (blocks stripped) — kept as the lead line. */
  leadText: string;
  leadBlocks: CoachBlock[];
  maybeAutoTitle: () => void;
}): AsyncGenerator<CoachChatEvent, boolean> {
  const { conversationId, userId, content, turnKey } = a.params;
  const save = (text: string, metadata: Record<string, unknown> | null) =>
    persistCoachReply(conversationId, userId, turnKey, text, metadata);

  const decision = decideOfferToolCall(
    a.rawArgs,
    getLatestFinderBlock(a.history),
  );
  switch (decision.kind) {
    case "invalid": {
      if (a.leadText || a.leadBlocks.length > 0) return false;
      await save(NO_DISH_TEXT, null);
      a.maybeAutoTitle();
      yield { type: "content", content: NO_DISH_TEXT };
      return true;
    }
    case "adjust": {
      // Repeat = yes: the same dish while the offer is open is a "Yes" tap.
      // The typed user row (route-inserted, finder.userMessageId) carries it;
      // the finder turn saves the lead ahead of the adjust card.
      yield* runCoachFinderTurn({
        conversationId,
        userId,
        content,
        turnKey,
        history: a.history,
        userMessageId: a.finder.userMessageId,
        entry: {
          kind: "finder",
          input: {
            kind: "action",
            action: { type: "offer_yes", flowId: decision.flow.flowId },
          },
          offer: true,
        },
        features: a.finder.features,
        leadText: a.leadText,
        leadBlocks: a.leadBlocks,
      });
      return true;
    }
    case "repost_adjust": {
      // Same dish while the card is live: re-post the same prefill under a
      // new flowId so the card stays the latest, live block.
      const block = {
        ...decision.block,
        flow: { ...decision.block.flow, flowId: randomUUID() },
      };
      const blocks: CoachBlock[] = [...a.leadBlocks, block];
      const existing = await save(
        withLead(a.leadText, finderFallbackText(block)),
        { blocks },
      );
      a.maybeAutoTitle();
      yield { type: "blocks", blocks: savedBlocks(existing, blocks, block) };
      return true;
    }
    case "offer": {
      const block = buildOfferBlock(
        decision.dish,
        decision.details,
        randomUUID(),
      );
      const blocks: CoachBlock[] = [...a.leadBlocks, block];
      const existing = await save(withLead(a.leadText, OFFER_TEXT), { blocks });
      a.maybeAutoTitle();
      yield { type: "blocks", blocks: savedBlocks(existing, blocks, block) };
      return true;
    }
  }
}

/**
 * Notebook extraction + archival for a completed Coach Pro turn. Run
 * fire-and-forget by `handleCoachChat`.
 */
async function extractAndStoreNotebook(a: {
  messageHistory: { role: "user" | "assistant" | "system"; content: string }[];
  content: string;
  textContent: string;
  userId: string;
  conversationId: number;
  /** Turn-start instant. */
  today: Date;
  tz: string;
}): Promise<void> {
  const {
    messageHistory,
    content,
    textContent,
    userId,
    conversationId,
    today,
    tz,
  } = a;
  const allMessages = [
    ...messageHistory,
    { role: "user" as const, content },
    { role: "assistant" as const, content: textContent },
  ];
  const entries = await extractNotebookEntries(
    allMessages,
    userId,
    conversationId,
    // `today` (declared above) is the turn-start instant, captured
    // before the coach's own response streams — passing it here
    // anchors the extraction prompt's "Current date" line to when the
    // user SPOKE, not a later `new Date()` computed after the SSE
    // stream drains. NOTE: this is not guaranteed to be the identical
    // instant the coach's own system prompt rendered its date from —
    // that is a separate, independently-defaulted `new Date()` in
    // nutrition-coach.ts's `buildSystemPrompt` — just the closer and
    // more correct of the two available anchors.
    { now: today, tz },
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
        // `civilDateToInstant`, not `new Date(dateStr)`: a bare parse
        // anchors at UTC midnight, which is BEFORE local midnight for
        // every UTC-negative user, so `getDueCommitmentsAllUsers` /
        // `getCommitmentsWithDueFollowUp` (coach-notebook.ts) — both
        // plain `lte(followUpDate, now)` instant comparisons — fire the
        // push reminder hours early. Anchoring correctly at write time
        // fixes both reads — neither needs its own timezone-aware
        // comparison. `server/routes/notebook.ts`'s POST/PATCH handlers
        // (the manual add/edit-entry screen) write the same column on
        // the same basis; a cross-surface test pins that they agree.
        // Rows written before either fix keep their UTC-midnight anchor.
        followUpDate: e.followUpDate
          ? civilDateToInstant(e.followUpDate, tz)
          : null,
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
    turnKey,
    isCoachPro,
    tz = "UTC",
    user,
    isAborted,
    abortSignal,
  } = params;

  // Classify intent once at the top of the turn — fixed for the duration.
  // Safety wins all ties. No re-classification inside the tool loop.
  const { intent: classifiedIntent } = classifyIntent(content);
  // A recipe_request that does not enter the finder (flag off, free Coach, a
  // turn routed elsewhere) keeps the prompt intent it had before this intent
  // existed — flag-off Coach is unchanged (spec §8).
  const intent: CoachIntent =
    classifiedIntent === "recipe_request"
      ? classifyIntent(content, { recipeRequests: false }).intent
      : classifiedIntent;

  // RECIPE_OFFER_ENABLED (spec 2026-10-06). Also requires the finder param:
  // the offer tool's repeat = yes delegation needs this turn's user row.
  const offerOn = !!params.finder && isRecipeOfferEnabled();

  // ── Recipe finder (Coach Pro, flag on) — early return (R2) ──
  if (params.finder && isCoachPro) {
    const recent = await storage.getChatMessages(conversationId, 20, userId);
    const entry = decideCoachFinderEntry(
      recent,
      content,
      classifiedIntent,
      params.finder.action,
      { offer: offerOn },
    );
    let finderEntry: CoachFinderTurnEntry | null = null;
    if (entry.kind === "finder") {
      finderEntry = { kind: "finder", input: entry.input, offer: offerOn };
    } else if (entry.kind === "classify") {
      const turn = await classifyTurn(content, entry.recipeTitle);
      // Offer on (H3): only refine_current stays in the finder; new_request
      // and other go to the tool loop, where the model decides.
      if (turn === "new_request" && !offerOn) {
        finderEntry = {
          kind: "finder",
          input: { kind: "start", text: content },
        };
      } else if (turn === "refine_current") {
        finderEntry = { kind: "refine" };
      }
    }
    if (finderEntry) {
      yield* runCoachFinderTurn({
        conversationId,
        userId,
        content,
        turnKey,
        history: recent,
        userMessageId: params.finder.userMessageId,
        entry: finderEntry,
        features: params.finder.features,
      });
      return;
    }
  }

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
    storage.getChatMessages(conversationId, 20, userId),
    isCoachPro
      ? storage.getDailyLogsInRange(userId, sevenDaysAgo, today)
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof storage.getDailyLogsInRange>>,
        ),
    isCoachPro
      ? storage.getActiveNotebookEntries(userId)
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof storage.getActiveNotebookEntries>>,
        ),
    isCoachPro
      ? storage.getCommitmentsWithDueFollowUp(userId)
      : Promise.resolve(
          [] as Awaited<
            ReturnType<typeof storage.getCommitmentsWithDueFollowUp>
          >,
        ),
    isCoachPro
      ? storage.getMostEatenFoods(userId, thirtyDaysAgo, today)
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof storage.getMostEatenFoods>>,
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
        getDayBucketInTz(today, tz),
        hashCoachCacheContext(context, today, tz),
        intent,
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
  let offerToolArgs: string | null = null;

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
      profile,
      // Reuse the intent classified once at the top of the turn — skips a
      // redundant classifyIntent call inside the generator.
      intent,
      tz,
      { offerRecipe: offerOn },
    )) {
      if (chunk.type === "tool_calls") {
        // Yielded immediately when the tools are detected, before they run —
        // surface the status event on the wire now instead of waiting for
        // the next content chunk.
        for (const name of chunk.toolNames) {
          if (!isAborted())
            yield { type: "status", label: getToolStatusLabel(name) };
        }
        if (isAborted()) break;
        continue;
      }
      // offer_recipe ends the generator; it is handled after the loop. A
      // client that already left gets nothing saved (as for plain text).
      if (chunk.type === "terminal_tool") {
        if (offerOn && !isAborted()) offerToolArgs = chunk.args;
        break;
      }
      if (isAborted()) break;
      fullResponse += chunk.content;
      yield { type: "content", content: chunk.content };
    }
  } else {
    for await (const chunk of generateCoachResponse(
      messageHistory,
      context,
      abortSignal,
      // Reuse the intent classified once at the top of the turn — skips a
      // redundant classifyIntent call inside the generator.
      intent,
      tz,
    )) {
      if (isAborted()) break;
      if (chunk === SAFETY_OVERRIDE_SENTINEL) {
        fullResponse = STANDARD_SAFETY_MESSAGE;
        yield { type: "safety_override", message: STANDARD_SAFETY_MESSAGE };
        break;
      }
      fullResponse += chunk;
      yield { type: "content", content: chunk };
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

  const maybeAutoTitle = () => {
    if (!isAborted() && history.length <= 1) {
      const shortTitle =
        content.slice(0, 50) + (content.length > 50 ? "..." : "");
      fireAndForget(
        "coach-chat-auto-title",
        storage.updateChatConversationTitle(conversationId, userId, shortTitle),
      );
    }
  };

  // ── offer_recipe (offer flag on) — save BEFORE yield, then return ──
  if (offerToolArgs !== null && params.finder) {
    const handled = yield* deliverOfferToolCall({
      params,
      finder: params.finder,
      rawArgs: offerToolArgs,
      history,
      leadText: textContent.trim(),
      leadBlocks: blocks,
      maybeAutoTitle,
    });
    if (handled) return;
  }

  if (fullResponse && !isAborted()) {
    await persistCoachReply(
      conversationId,
      userId,
      turnKey,
      textContent,
      blocks.length > 0 ? { blocks } : null,
    );
  }

  // Cache write after DB write (ordering fix: cache should only exist for persisted messages)
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

  maybeAutoTitle();

  // Send blocks in the final event for Coach Pro
  if (!isAborted() && blocks.length > 0) {
    yield { type: "blocks", blocks };
  }

  // Fire-and-forget notebook extraction + archival for Coach Pro
  if (isCoachPro && fullResponse && !isAborted()) {
    fireAndForget(
      "coach-notebook-extraction",
      extractAndStoreNotebook({
        messageHistory,
        content,
        textContent,
        userId,
        conversationId,
        today,
        tz,
      }),
    );
  }
}
