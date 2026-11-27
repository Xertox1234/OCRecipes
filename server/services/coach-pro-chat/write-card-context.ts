import { storage } from "../../storage";
import { createServiceLogger, toError } from "../../lib/logger";
import { sanitizeContextField } from "../../lib/ai-safety";
import { isRecipeFinderEnabled } from "../recipe-finder/config";
import { getBlocksSystemPrompt } from "../coach-blocks";
import type { CoachContext } from "../coach-prompt";
import {
  buildWriteCardPayload,
  describeLiveCard,
  describeLoggedFood,
  performWriteCardSave,
  revertWriteCardSave,
  writeCardReceiptFor,
  WriteCardEditError,
  type WriteCardProposal,
} from "../write-cards";
import {
  WRITE_CARD_EDITS_SCHEMAS,
  type FoodCardPayload,
  type WriteCardBlock,
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
    quickLog?: boolean;
    dayProgress?: boolean;
    weekProgress?: boolean;
    moreCharts?: boolean;
    labelCompare?: boolean;
    weeklyReport?: boolean;
  },
): Promise<void> {
  context.blocksPrompt = getBlocksSystemPrompt(isRecipeFinderEnabled(), {
    writeCards: true,
    notesPaused: context.notesPaused,
    ...(a.quickLog && { quickLog: true }),
    ...(a.dayProgress && { dayProgress: true }),
    ...(a.weekProgress && { weekProgress: true }),
    ...(a.moreCharts && { moreCharts: true }),
    ...(a.labelCompare && { labelCompare: true }),
    ...(a.weeklyReport && { weeklyReport: true }),
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
  const lines: string[] = [];
  const live = await storage.getLiveWriteCard(a.conversationId, a.userId);
  if (live) pushCardLine(lines, live.kind, describeLiveCard(live));
  if (a.quickLog) {
    // A food logged at once is saved, not live, so no line above names it:
    // without this, "make it three eggs" would be logged a second time.
    const logged = await storage.getLatestLoggedFoodCard(
      a.conversationId,
      a.userId,
    );
    if (logged) pushCardLine(lines, "food", describeLoggedFood(logged));
  }
  if (lines.length > 0) {
    // Item names came from model output — sanitize like any context field.
    context.liveWriteCard = sanitizeContextField(lines.join("\n"), 1800);
  }
}

/** A card whose stored payload no longer parses gets no line (audit L52). */
function pushCardLine(lines: string[], kind: string, line: string | null) {
  if (line === null) {
    log.warn({ kind }, "coach write card payload does not parse");
    return;
  }
  lines.push(line);
}

/** Builds the proposal's card and its row; null (logged) when it can't. */
export async function createWriteCardBlock(
  proposal: WriteCardProposal,
  a: {
    conversationId: number;
    userId: string;
    tz: string;
    /** True once the client has left; checked again after each slow step. */
    isAborted?: () => boolean;
  },
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
    // The build can take seconds (nutrition lookups). A client that left
    // meanwhile gets no row: it would lock the card it was looking at, and
    // the reply that names it is never saved (audit 2026-11-24, L87).
    if (a.isAborted?.()) return null;
    const { card, previous } = await storage.createWriteCard({
      userId: a.userId,
      conversationId: a.conversationId,
      kind: proposal.kind,
      payload,
    });
    if (a.isAborted?.()) {
      // Left while the row was written: take it back.
      await storage.withdrawWriteCard({
        cardId: card.id,
        userId: a.userId,
        previous,
      });
      return null;
    }
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

/**
 * Coach roadmap T2: logs a small food card at once, during the tool call, so
 * the tool result only ever says what has happened. The card is created and
 * saved in one step with the card's own contents (as a Save tap with no
 * edits). Null (logged) when it could not be: the turn then gets a card
 * waiting on Save, and the tool is told so.
 */
export async function logFoodAtOnce(
  payload: FoodCardPayload,
  a: { conversationId: number; userId: string; tz: string },
): Promise<WriteCardBlock | null> {
  try {
    const { card, previous } = await storage.createLoggedWriteCard(
      {
        userId: a.userId,
        conversationId: a.conversationId,
        kind: "food",
        payload,
      },
      (tx, row) =>
        performWriteCardSave(
          tx,
          row,
          {},
          {
            userId: a.userId,
            tz: a.tz,
            now: new Date(),
          },
        ),
    );
    return {
      type: "write_card",
      cardId: card.id,
      kind: "food",
      payload,
      status: "saved",
      receipt: writeCardReceiptFor(card),
      loggedAtOnce: true,
      ...(previous && { replacesCardId: previous.id }),
    };
  } catch (err) {
    // A save the card refuses on purpose is a warning; anything else (a
    // storage break) is an error, so Sentry sees it. Never log the payload.
    const fields = { err: toError(err), kind: "food" };
    if (err instanceof WriteCardEditError) {
      log.warn(fields, "coach write card not logged at once");
    } else {
      log.error(fields, "coach write card not logged at once");
    }
    return null;
  }
}

/**
 * Takes back a log applied at once that no reply will show (the client left,
 * the safety message replaced the reply, or it came back empty), so no food
 * is logged that the user cannot see or undo.
 */
export async function withdrawFoodLoggedAtOnce(
  block: WriteCardBlock,
  userId: string,
): Promise<void> {
  try {
    await storage.withdrawLoggedWriteCard(block.cardId, userId, (tx, card) =>
      revertWriteCardSave(tx, card),
    );
  } catch (err) {
    log.error(
      { err: toError(err), kind: block.kind },
      "coach write card logged at once not withdrawn",
    );
  }
}
