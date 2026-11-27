import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
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
 * `WriteCardTx` is the query surface a save/undo callback gets: the
 * transaction client, so the write-card services run their storage writes on
 * the same client as the status flip.
 */
export type WriteCardTx = Pick<
  typeof db,
  "transaction" | "select" | "insert" | "update" | "delete"
>;

/**
 * Health-data consent withdrawn: closes every allergy and family card the
 * user has and blanks the severities they chose (edits, saved refs). Both
 * are structured allergy records (the family card's for another person,
 * Coach roadmap A3); no other kind holds health data. Runs on the
 * withdrawal's own transaction. The allergens stay in the payload, as they
 * do in the chat text around the card.
 */
export async function expireAllergyCards(
  userId: string,
  executor: Pick<typeof db, "update">,
): Promise<void> {
  await executor
    .update(coachWriteCards)
    .set({ status: "expired", edits: {}, savedRefs: null })
    .where(
      and(
        eq(coachWriteCards.userId, userId),
        inArray(coachWriteCards.kind, ["allergy", "family"]),
      ),
    );
}

/** Server undo window — the UI shows Undo for 6 s; this absorbs latency. */
export const WRITE_CARD_UNDO_WINDOW_MS = 60_000;

/**
 * A small food log applied at once (Coach roadmap T2) was never tapped: the
 * user may only see its card once they read the reply. Longer, so Undo is
 * still there when they do.
 */
export const LOGGED_AT_ONCE_UNDO_WINDOW_MS = 5 * 60_000;

/** Whether a saved card can still be undone at `now`. */
export function undoWindowOpen(card: CoachWriteCard, now: Date): boolean {
  if (card.status !== "saved" || !card.savedAt) return false;
  const window = card.savedRefs?.loggedAtOnce
    ? LOGGED_AT_ONCE_UNDO_WINDOW_MS
    : WRITE_CARD_UNDO_WINDOW_MS;
  return now.getTime() - card.savedAt.getTime() <= window;
}

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

/**
 * Coach roadmap T2: a small food log the Coach applies at once. One
 * transaction creates the card and saves it, so a failed save leaves nothing
 * behind. A live food card is replaced (the user is changing it); a live
 * card of another kind stays live, since this card never is.
 */
export async function createLoggedWriteCard(
  input: {
    userId: string;
    conversationId: number;
    kind: "food";
    payload: Record<string, unknown>;
  },
  perform: (
    tx: WriteCardTx,
    card: CoachWriteCard,
  ) => Promise<CoachWriteCardSavedRefs>,
): Promise<{
  card: CoachWriteCard;
  previous: { id: string; status: "replaced" } | null;
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
    let previous: { id: string; status: "replaced" } | null = null;
    if (live?.kind === "food") {
      await tx
        .update(coachWriteCards)
        .set({ status: "replaced" })
        .where(eq(coachWriteCards.id, live.id));
      previous = { id: live.id, status: "replaced" };
    }
    // Inserted as saved: never live, so never a second live card.
    const [inserted] = await tx
      .insert(coachWriteCards)
      .values({
        userId: input.userId,
        conversationId: input.conversationId,
        kind: input.kind,
        payload: input.payload,
        status: "saved",
        edits: {},
      })
      .returning();
    const refs = await perform(tx, inserted);
    const [card] = await tx
      .update(coachWriteCards)
      .set({
        savedRefs: { ...refs, loggedAtOnce: true },
        // JS time, not now(): see saveWriteCard.
        savedAt: new Date(),
      })
      .where(eq(coachWriteCards.id, inserted.id))
      .returning();
    return { card, previous };
  });
}

/**
 * Takes back a log applied at once that the user never got to see (the turn
 * was abandoned, replaced by the safety message, or came back empty). The
 * log is reverted and the card closed, never live: no reply shows it.
 * False when there is nothing to withdraw.
 */
export async function withdrawLoggedWriteCard(
  id: string,
  userId: string,
  revert: (tx: WriteCardTx, card: CoachWriteCard) => Promise<void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(coachWriteCards)
      .where(
        and(eq(coachWriteCards.id, id), eq(coachWriteCards.userId, userId)),
      )
      .for("update");
    if (!card || card.status !== "saved" || !card.savedRefs?.loggedAtOnce) {
      return false;
    }
    await revert(tx, card);
    await tx
      .update(coachWriteCards)
      .set({ status: "expired", savedRefs: null, savedAt: null })
      .where(eq(coachWriteCards.id, id));
    return true;
  });
}

/**
 * The newest food log applied at once in a conversation, still logged. The
 * Coach is told of it, so "make it three" is not logged a second time.
 */
export async function getLatestLoggedFoodCard(
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
        eq(coachWriteCards.kind, "food"),
        eq(coachWriteCards.status, "saved"),
        sql`${coachWriteCards.savedRefs}->>'loggedAtOnce' = 'true'`,
      ),
    )
    .orderBy(desc(coachWriteCards.savedAt))
    .limit(1);
  return card;
}

/**
 * Take back a card created for a turn whose client left before it was shown
 * (audit 2026-11-24, L87): delete it and put the card it replaced back to
 * live, so the card the user was looking at still saves. The previous card is
 * revived only while it still has the status this card gave it and the
 * conversation has no other live card.
 */
export async function withdrawWriteCard(input: {
  cardId: string;
  userId: string;
  previous: { id: string; status: "replaced" | "expired" } | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(coachWriteCards)
      .where(
        and(
          eq(coachWriteCards.id, input.cardId),
          eq(coachWriteCards.userId, input.userId),
          eq(coachWriteCards.status, "live"),
        ),
      )
      .returning({ conversationId: coachWriteCards.conversationId });
    if (!removed || !input.previous) return;
    const [otherLive] = await tx
      .select({ id: coachWriteCards.id })
      .from(coachWriteCards)
      .where(
        and(
          eq(coachWriteCards.conversationId, removed.conversationId),
          eq(coachWriteCards.userId, input.userId),
          eq(coachWriteCards.status, "live"),
        ),
      );
    if (otherLive) return;
    await tx
      .update(coachWriteCards)
      .set({ status: "live" })
      .where(
        and(
          eq(coachWriteCards.id, input.previous.id),
          eq(coachWriteCards.userId, input.userId),
          eq(coachWriteCards.status, input.previous.status),
        ),
      );
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
  /** The edits this save used; stored for the receipt. Omit to keep the card's. */
  edits?: Record<string, unknown>,
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
      .set({
        status: "saved",
        savedRefs,
        savedAt: new Date(),
        ...(edits !== undefined && { edits }),
      })
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
    if (!undoWindowOpen(card, now)) return { status: "too_late" };

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
