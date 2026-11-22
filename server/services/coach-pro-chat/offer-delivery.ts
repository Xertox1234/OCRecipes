import { randomUUID } from "crypto";
import { storage } from "../../storage";
import { createServiceLogger } from "../../lib/logger";
import type { ChatMessage } from "@shared/schema";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import { decideOfferToolCall, buildOfferBlock } from "../recipe-finder/offer";
import { getLatestFinderBlock } from "../recipe-finder";
import {
  runCoachFinderTurn,
  savedBlocks,
  withLead,
} from "../recipe-finder/coach-turn";
import { OFFER_TEXT, finderFallbackText } from "../recipe-finder/fallback-text";
import type { CoachChatEvent, CoachChatParams } from "./types";

const log = createServiceLogger("coach-pro-chat");

/**
 * Persists the assistant reply once per turnKey (SSE retries replay turns).
 * Returns the already-saved row on a turnKey hit, else undefined.
 */
export async function persistCoachReply(
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
export async function* deliverOfferToolCall(a: {
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
