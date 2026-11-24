import { storage } from "../../storage";
import { createServiceLogger, toError } from "../../lib/logger";
import { sanitizeContextField } from "../../lib/ai-safety";
import { isRecipeFinderEnabled } from "../recipe-finder/config";
import { getBlocksSystemPrompt } from "../coach-blocks";
import type { CoachContext } from "../coach-prompt";
import {
  buildWriteCardPayload,
  describeLiveCard,
  WriteCardEditError,
  type WriteCardProposal,
} from "../write-cards";
import {
  WRITE_CARD_EDITS_SCHEMAS,
  type WriteCardPayload,
} from "@shared/schemas/coach-write-cards";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

const log = createServiceLogger("coach-pro-chat");

/**
 * Write-card mode's prompt context: store the edits the app sent for the live
 * card (only if they parse and the card is this conversation's live card),
 * then describe the live card so "make it three eggs" starts from what is on
 * screen now.
 */
export async function applyWriteCardContext(
  context: CoachContext,
  a: {
    conversationId: number;
    userId: string;
    liveCard?: { cardId: string; edits: Record<string, unknown> };
  },
): Promise<void> {
  context.blocksPrompt = getBlocksSystemPrompt(isRecipeFinderEnabled(), {
    writeCards: true,
    notesPaused: context.notesPaused,
  });
  if (a.liveCard) {
    const card = await storage.getWriteCard(a.liveCard.cardId, a.userId);
    if (
      card &&
      card.conversationId === a.conversationId &&
      card.status === "live" &&
      WRITE_CARD_EDITS_SCHEMAS[card.kind].safeParse(a.liveCard.edits).success
    ) {
      await storage.setWriteCardEdits(card.id, a.userId, a.liveCard.edits);
    }
  }
  const live = await storage.getLiveWriteCard(a.conversationId, a.userId);
  if (live) {
    // Item names came from model output — sanitize like any context field.
    context.liveWriteCard = sanitizeContextField(describeLiveCard(live), 1500);
  }
}

/** Builds the proposal's card and its row; null (logged) when it can't. */
export async function createWriteCardBlock(
  proposal: WriteCardProposal,
  a: { conversationId: number; userId: string; tz: string },
  /** A payload the tool call already worked out (grocery). */
  prepared?: WriteCardPayload | null,
): Promise<CoachBlock | null> {
  try {
    const payload =
      prepared ??
      (await buildWriteCardPayload(proposal, {
        userId: a.userId,
        tz: a.tz,
        now: new Date(),
      }));
    const { card, previous } = await storage.createWriteCard({
      userId: a.userId,
      conversationId: a.conversationId,
      kind: proposal.kind,
      payload,
    });
    return {
      type: "write_card",
      cardId: card.id,
      kind: proposal.kind,
      payload,
      status: "live",
      ...(previous?.status === "replaced" && { replacesCardId: previous.id }),
    };
  } catch (err) {
    // A card the builder refuses on purpose (nothing to log, a recipe gone)
    // is a warning. Anything else (a storage or migration break) leaves the
    // reply promising a card that never appears: error level, so Sentry sees
    // it (reliability audit 2026-11-19, M-obs-2). Never log the payload.
    const fields = { err: toError(err), kind: proposal.kind };
    if (err instanceof WriteCardEditError) {
      log.warn(fields, "coach write card not built");
    } else {
      log.error(fields, "coach write card not built");
    }
    return null;
  }
}
