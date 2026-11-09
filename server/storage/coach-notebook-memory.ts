/**
 * Visible memory (spec docs/superpowers/specs/2026-11-08-coach-visible-memory-design.md):
 * the save popup's confirm / Undo, the unseen-saves feed, the confirmed set the
 * coach may speak, and "Clear everything Coach knows". Every function is
 * scoped to the caller's userId in SQL.
 */
import {
  coachNotebook,
  userProfiles,
  type CoachNotebookEntry,
} from "@shared/schema";
import { and, asc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
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

/** Undo / Remove: kept as `rejected` so extraction never re-saves the fact. */
export async function rejectNotebookEntries(
  userId: string,
  ids: number[],
): Promise<number> {
  const rows = await db
    .update(coachNotebook)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(
      and(
        eq(coachNotebook.userId, userId),
        inArray(coachNotebook.id, [...new Set(ids)]),
      ),
    )
    .returning({ id: coachNotebook.id });
  return rows.length;
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
  await db.delete(coachNotebook).where(eq(coachNotebook.userId, userId));
  await db
    .update(userProfiles)
    .set({ moodScore: 0, moodUpdatedAt: null })
    .where(eq(userProfiles.userId, userId));
}

/**
 * Nudge the user's mood score: decay the stored value, add the delta, clamp.
 * Row-locked so two quick turns can't overwrite each other. A user without a
 * profile row has no score to move.
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
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .for("update");
    if (!profile) return;
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
