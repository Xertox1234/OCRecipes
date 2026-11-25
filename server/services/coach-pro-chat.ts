/**
 * Coach Pro Chat Service
 *
 * Orchestrates the Coach chat path (both standard and Pro) as stages; the
 * tier picks which run:
 *   - finder gate (Pro, flag on): early return into the recipe finder
 *   - loadTurnContext: storage reads, context, warm-up, truncation, cache check
 *   - streamReply: cached replay | Pro tool loop | free stream, then safety re-scan
 *   - finalizeTurn: blocks, offer, persistence, cache write, title, notebook
 *
 * Stages live in ./coach-pro-chat/. Extracted from server/routes/chat.ts to
 * keep route handlers thin.
 */

import { storage } from "../storage";
import {
  classifyIntent,
  matchesSelfHarm,
  type CoachIntent,
} from "./coach-intent-classifier";
import {
  SAFETY_CRISIS_FALLBACK_MESSAGE,
  STANDARD_SAFETY_MESSAGE,
} from "../lib/ai-safety";
import {
  buildMealPatternSummary,
  type CoachChatUser,
} from "./coach-context-builder";
import {
  hashCoachCacheContext,
  hashCoachCacheKey,
  hashNotebookDedupeKey,
} from "./coach-cache-keys";
import { isRecipeOfferEnabled } from "./recipe-finder";
import { runCoachFinderTurn } from "./recipe-finder/coach-turn";
import { resolveFinderEntry } from "./coach-pro-chat/finder-gate";
import { loadTurnContext } from "./coach-pro-chat/load-turn-context";
import { streamReply } from "./coach-pro-chat/stream-reply";
import { finalizeTurn } from "./coach-pro-chat/finalize-turn";
import { persistCoachReply } from "./coach-pro-chat/offer-delivery";
import {
  ARCHIVE_THROTTLE_MS,
  lastArchivedAt,
  shouldRunArchive,
} from "./coach-pro-chat/notebook";
import type { CoachChatEvent, CoachChatParams } from "./coach-pro-chat/types";

// Re-exported so existing importers (tests) keep their import path.
export {
  hashCoachCacheContext,
  hashCoachCacheKey,
  hashNotebookDedupeKey,
  buildMealPatternSummary,
};

export type { CoachChatEvent, CoachChatParams, CoachChatUser };

export { STANDARD_SAFETY_MESSAGE };

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
  const { conversationId, userId, content, turnKey, isCoachPro } = params;
  // Write cards ride on Coach Pro's blocks; the free tier never gets them.
  const writeCards = !!params.writeCards && isCoachPro;
  const pantryCard = writeCards && !!params.pantryCard;
  const goalsCard = writeCards && !!params.goalsCard;
  const planShopCard = writeCards && !!params.planShopCard;

  // Suicide or self-harm: the crisis message, from the server, on both tiers
  // (audit 2026-11-24, H3). The model is never called, so the reply cannot
  // open on the food log or close with a meal offer. Nothing else runs for
  // this turn: no finder, no cache write, no chat title from the user's
  // words, and no notebook extraction.
  if (matchesSelfHarm(content)) {
    if (params.isAborted()) return;
    yield { type: "content", content: SAFETY_CRISIS_FALLBACK_MESSAGE };
    await persistCoachReply(
      conversationId,
      userId,
      turnKey,
      SAFETY_CRISIS_FALLBACK_MESSAGE,
      null,
    );
    return;
  }

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
  const finder = await resolveFinderEntry(params, classifiedIntent, offerOn);
  if (finder.entry && params.finder) {
    yield* runCoachFinderTurn({
      conversationId,
      userId,
      content,
      turnKey,
      history: finder.history ?? [],
      userMessageId: params.finder.userMessageId,
      entry: finder.entry,
      features: params.finder.features,
    });
    return;
  }

  const turn = await loadTurnContext(params, {
    writeCards,
    intent,
    finderHistory: finder.history,
  });
  const reply = yield* streamReply({
    params,
    turn,
    intent,
    offerOn,
    writeCards,
    pantryCard,
    goalsCard,
    planShopCard,
  });
  yield* finalizeTurn(params, turn, reply, intent);
}
