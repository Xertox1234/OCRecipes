import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import {
  coachWriteCards,
  type CoachWriteCard,
  type CoachWriteCardSavedRefs,
} from "@shared/schema";
import type { WriteCardKind } from "@shared/schemas/coach-write-cards";

/**
 * Coach write cards (spec 2026-11-09). Every function filters by `userId`, so
 * a card id from another user reads as absent (IDOR-safe).
 *
 * The transaction client type is taken from `db.transaction` so the write-card
 * services can run their storage writes on the same client as the status flip.
 */
export type WriteCardTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Server undo window — the UI shows Undo for 6 s; this absorbs latency. */
export const WRITE_CARD_UNDO_WINDOW_MS = 60_000;

export async function createWriteCard(input: {
  userId: string;
  conversationId: number;
  kind: WriteCardKind;
  payload: Record<string, unknown>;
}): Promise<{
  card: CoachWriteCard;
  previous: { id: string; status: "replaced" | "expired" } | null;
}> {
  return db.transaction(async (tx) => {
    const [live] = await tx
      .select()
      .from(coachWriteCards)
      .where(
        and(
          eq(coachWriteCards.conversationId, input.conversationId),
          eq(coachWriteCards.userId, input.userId),
          eq(coachWriteCards.status, "live"),
        ),
      )
      .for("update");

    let previous: { id: string; status: "replaced" | "expired" } | null = null;
    if (live) {
      const status = live.kind === input.kind ? "replaced" : "expired";
      await tx
        .update(coachWriteCards)
        .set({ status })
        .where(eq(coachWriteCards.id, live.id));
      previous = { id: live.id, status };
    }

    const [card] = await tx
      .insert(coachWriteCards)
      .values({
        userId: input.userId,
        conversationId: input.conversationId,
        kind: input.kind,
        payload: input.payload,
      })
      .returning();
    return { card, previous };
  });
}

export async function getWriteCard( // idor-safe: filtered by userId
  id: string,
  userId: string,
): Promise<CoachWriteCard | undefined> {
  const [card] = await db
    .select()
    .from(coachWriteCards)
    .where(and(eq(coachWriteCards.id, id), eq(coachWriteCards.userId, userId)));
  return card;
}

export async function getLiveWriteCard(
  conversationId: number,
  userId: string,
): Promise<CoachWriteCard | undefined> {
  const [card] = await db
    .select()
    .from(coachWriteCards)
    .where(
      and(
        eq(coachWriteCards.conversationId, conversationId),
        eq(coachWriteCards.userId, userId),
        eq(coachWriteCards.status, "live"),
      ),
    );
  return card;
}

/** Stores the user's edits; false when the card is not (or no longer) live. */
export async function setWriteCardEdits(
  id: string,
  userId: string,
  edits: Record<string, unknown>,
): Promise<boolean> {
  const rows = await db
    .update(coachWriteCards)
    .set({ edits })
    .where(
      and(
        eq(coachWriteCards.id, id),
        eq(coachWriteCards.userId, userId),
        eq(coachWriteCards.status, "live"),
      ),
    )
    .returning({ id: coachWriteCards.id });
  return rows.length > 0;
}

export type SaveWriteCardResult =
  | { status: "saved"; card: CoachWriteCard }
  | { status: "already_saved"; card: CoachWriteCard }
  | { status: "locked"; card: CoachWriteCard }
  | { status: "not_found" };

/**
 * Saves a live card exactly once. The row lock serialises a double tap: the
 * second call waits, then sees `saved` and returns `already_saved` without
 * running `perform`. A throw from `perform` rolls everything back and the card
 * stays live.
 */
export async function saveWriteCard(
  id: string,
  userId: string,
  perform: (
    tx: WriteCardTx,
    card: CoachWriteCard,
  ) => Promise<CoachWriteCardSavedRefs>,
): Promise<SaveWriteCardResult> {
  return db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(coachWriteCards)
      .where(
        and(eq(coachWriteCards.id, id), eq(coachWriteCards.userId, userId)),
      )
      .for("update");
    if (!card) return { status: "not_found" };
    if (card.status === "saved") return { status: "already_saved", card };
    if (card.status !== "live") return { status: "locked", card };

    const savedRefs = await perform(tx, card);
    // JS time, not now(): now() is the transaction START, which the undo
    // window would then measure from.
    const [saved] = await tx
      .update(coachWriteCards)
      .set({ status: "saved", savedRefs, savedAt: new Date() })
      .where(eq(coachWriteCards.id, id))
      .returning();
    return { status: "saved", card: saved };
  });
}

export type UndoWriteCardResult =
  | { status: "undone"; card: CoachWriteCard }
  | { status: "too_late" | "not_saved" | "not_found" };

/**
 * Reverts a save made within the undo window. The card goes back to `live` so
 * the user can fix it and save again — unless a newer card went live since,
 * in which case it becomes `expired` (never two live cards).
 */
export async function undoWriteCard(
  id: string,
  userId: string,
  revert: (tx: WriteCardTx, card: CoachWriteCard) => Promise<void>,
  now: Date = new Date(),
): Promise<UndoWriteCardResult> {
  return db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(coachWriteCards)
      .where(
        and(eq(coachWriteCards.id, id), eq(coachWriteCards.userId, userId)),
      )
      .for("update");
    if (!card) return { status: "not_found" };
    if (card.status !== "saved" || !card.savedAt)
      return { status: "not_saved" };
    if (now.getTime() - card.savedAt.getTime() > WRITE_CARD_UNDO_WINDOW_MS) {
      return { status: "too_late" };
    }

    await revert(tx, card);

    const [otherLive] = await tx
      .select({ id: coachWriteCards.id })
      .from(coachWriteCards)
      .where(
        and(
          eq(coachWriteCards.conversationId, card.conversationId),
          eq(coachWriteCards.status, "live"),
          ne(coachWriteCards.id, id),
        ),
      );
    const [undone] = await tx
      .update(coachWriteCards)
      .set({
        status: otherLive ? "expired" : "live",
        savedRefs: null,
        savedAt: null,
      })
      .where(eq(coachWriteCards.id, id))
      .returning();
    return { status: "undone", card: undone };
  });
}

/** Batch read for enriching GET messages; only the user's own cards. */
export async function getWriteCardsByIds(
  userId: string,
  ids: string[],
): Promise<CoachWriteCard[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return db
    .select()
    .from(coachWriteCards)
    .where(
      and(
        eq(coachWriteCards.userId, userId),
        inArray(coachWriteCards.id, unique),
      ),
    );
}
