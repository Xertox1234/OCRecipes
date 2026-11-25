/**
 * Visible memory (spec docs/superpowers/specs/2026-11-08-coach-visible-memory-design.md):
 * the save popup's confirm / Undo, the unseen-saves feed, the confirmed set the
 * coach may speak, and "Clear everything Coach knows". Every function is
 * scoped to the caller's userId in SQL.
 */
import {
  coachNotebook,
  pendingReminders,
  userProfiles,
  type CoachNotebookEntry,
} from "@shared/schema";
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
} from "drizzle-orm";
import { db } from "../db";
import { deleteCommitmentReminders } from "./reminders";
import { insightKey, sameTip } from "@shared/lib/coach-stats";
import { MAX_NOTEBOOK_ENTRIES } from "@shared/schemas/coach-notebook";
import { applyMoodDelta } from "@shared/lib/mood";

/** The only notebook types the coach may say out loud, or show in the popup. */
export const SPEAKABLE_NOTEBOOK_TYPES = [
  "goal",
  "preference",
  "commitment",
] as const;

const UNSEEN_WINDOW_DAYS = 7;
const MAX_UNSEEN = 10;

export async function confirmNotebookEntries(
  userId: string,
  ids: number[],
): Promise<number> {
  const now = new Date();
  const rows = await db
    .update(coachNotebook)
    .set({ confirmedAt: now, shownAt: now })
    .where(
      and(
        eq(coachNotebook.userId, userId),
        inArray(coachNotebook.id, [...new Set(ids)]),
        isNull(coachNotebook.confirmedAt),
      ),
    )
    .returning({ id: coachNotebook.id });
  return rows.length;
}

/**
 * The user accepted a commitment card (coach chat audit 2026-11-24, L57/L64).
 * The note extraction may have saved the same commitment from that turn: then
 * it is confirmed, else a new one is added. The profile row is locked, so a
 * second Accept, or an extraction writing at the same time, sees this one.
 */
export async function acceptCommitment(
  userId: string,
  card: { title: string; followUpDate: Date | null },
): Promise<"saved" | "full"> {
  return db.transaction(async (tx) => {
    await tx
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .for("update");
    const now = new Date();
    const active = await tx
      .select({
        id: coachNotebook.id,
        content: coachNotebook.content,
        label: coachNotebook.label,
        confirmedAt: coachNotebook.confirmedAt,
      })
      .from(coachNotebook)
      .where(
        and(
          eq(coachNotebook.userId, userId),
          eq(coachNotebook.type, "commitment"),
          eq(coachNotebook.status, "active"),
        ),
      );
    const key = insightKey(card.title);
    const match = active.find((row) => sameTip(insightKey(row.content), key));
    if (match) {
      await tx
        .update(coachNotebook)
        .set({
          confirmedAt: match.confirmedAt ?? now,
          shownAt: now,
          updatedAt: now,
          label: match.label ?? card.title,
          ...(card.followUpDate && { followUpDate: card.followUpDate }),
        })
        .where(
          and(eq(coachNotebook.id, match.id), eq(coachNotebook.userId, userId)),
        );
      return "saved";
    }
    const [held] = await tx
      .select({ total: count() })
      .from(coachNotebook)
      .where(
        and(
          eq(coachNotebook.userId, userId),
          ne(coachNotebook.status, "archived"),
        ),
      );
    if ((held?.total ?? 0) >= MAX_NOTEBOOK_ENTRIES) return "full";
    await tx.insert(coachNotebook).values({
      userId,
      type: "commitment",
      content: card.title,
      label: card.title,
      status: "active",
      followUpDate: card.followUpDate,
      confirmedAt: now,
      shownAt: now,
    });
    return "saved";
  });
}

/** Undo / Remove: kept as `rejected` so extraction never re-saves the fact. */
export async function rejectNotebookEntries(
  userId: string,
  ids: number[],
): Promise<number> {
  const unique = [...new Set(ids)];
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(coachNotebook)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(coachNotebook.userId, userId),
          inArray(coachNotebook.id, unique),
        ),
      )
      .returning({ id: coachNotebook.id });
    await deleteCommitmentReminders(
      tx,
      userId,
      rows.map((r) => r.id),
    );
    return rows.length;
  });
}

export async function markNotebookEntriesShown(
  userId: string,
  ids: number[],
): Promise<void> {
  await db
    .update(coachNotebook)
    .set({ shownAt: new Date() })
    .where(
      and(
        eq(coachNotebook.userId, userId),
        inArray(coachNotebook.id, [...new Set(ids)]),
        isNull(coachNotebook.shownAt),
      ),
    );
}

/** New saves the user hasn't been shown yet: speakable types, last 7 days. */
export async function getUnseenNotebookSaves(
  userId: string,
): Promise<CoachNotebookEntry[]> {
  const since = new Date(Date.now() - UNSEEN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(coachNotebook)
    .where(
      and(
        eq(coachNotebook.userId, userId),
        eq(coachNotebook.status, "active"),
        isNull(coachNotebook.shownAt),
        inArray(coachNotebook.type, [...SPEAKABLE_NOTEBOOK_TYPES]),
        gte(coachNotebook.createdAt, since),
      ),
    )
    .orderBy(asc(coachNotebook.createdAt), asc(coachNotebook.id))
    .limit(MAX_UNSEEN);
}

/** What the coach may say out loud: confirmed, active, speakable entries. */
export async function getConfirmedNotebookEntries(
  userId: string,
): Promise<CoachNotebookEntry[]> {
  return db
    .select()
    .from(coachNotebook)
    .where(
      and(
        eq(coachNotebook.userId, userId),
        eq(coachNotebook.status, "active"),
        isNotNull(coachNotebook.confirmedAt),
        inArray(coachNotebook.type, [...SPEAKABLE_NOTEBOOK_TYPES]),
      ),
    )
    .orderBy(asc(coachNotebook.id));
}

/** "Clear everything Coach knows": every row, hidden types too, and mood. */
export async function clearNotebook(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // The profile first: it takes the row lock a note write from a chat turn
    // holds while it checks this stamp, so a turn that started before the
    // clear either finishes before these deletes or sees the stamp and writes
    // nothing (L108). The server's clock, like the turn start it is compared
    // with.
    await tx
      .update(userProfiles)
      .set({ moodScore: 0, moodUpdatedAt: null, notebookClearedAt: new Date() })
      .where(eq(userProfiles.userId, userId));
    await tx.delete(coachNotebook).where(eq(coachNotebook.userId, userId));
    // Reminder rows hold a copy of the commitment's text.
    await tx
      .delete(pendingReminders)
      .where(
        and(
          eq(pendingReminders.userId, userId),
          eq(pendingReminders.type, "commitment"),
        ),
      );
  });
}

/**
 * Nudge the user's mood score: decay the stored value, add the delta, clamp.
 * Row-locked so two quick turns can't overwrite each other. A user without a
 * profile row, or without the health-data consent, has no score to move.
 */
export async function updateMoodScore(
  userId: string,
  delta: number,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [profile] = await tx
      .select({
        moodScore: userProfiles.moodScore,
        moodUpdatedAt: userProfiles.moodUpdatedAt,
        healthDataConsentAt: userProfiles.healthDataConsentAt,
        notebookClearedAt: userProfiles.notebookClearedAt,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .for("update");
    // No consent, no health data: the mood signal is health-derived.
    if (!profile || profile.healthDataConsentAt == null) return;
    // `now` is the turn's start: a nudge from a turn that began before the
    // user cleared everything is dropped, like its notes (L108).
    if (
      profile.notebookClearedAt !== null &&
      profile.notebookClearedAt.getTime() >= now.getTime()
    )
      return;
    await tx
      .update(userProfiles)
      .set({
        moodScore: applyMoodDelta(
          profile.moodScore,
          profile.moodUpdatedAt,
          delta,
          now,
        ),
        moodUpdatedAt: now,
      })
      .where(eq(userProfiles.userId, userId));
  });
}
