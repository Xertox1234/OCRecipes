import {
  coachNotebook,
  type CoachNotebookEntry,
  type InsertCoachNotebookEntry,
} from "@shared/schema";
import type {
  NotebookEntryStatus,
  NotebookEntryType,
} from "@shared/schemas/coach-notebook";
import { db } from "../db";
import { logger } from "../lib/logger";
import {
  eq,
  and,
  asc,
  desc,
  gt,
  lte,
  sql,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import { createHash } from "crypto";
import { insightKey, sameTip } from "@shared/lib/coach-stats";

export async function getActiveNotebookEntries(
  userId: string,
  types?: NotebookEntryType[],
): Promise<CoachNotebookEntry[]> {
  const conditions = [
    eq(coachNotebook.userId, userId),
    eq(coachNotebook.status, "active"),
  ];
  if (types && types.length > 0) {
    conditions.push(inArray(coachNotebook.type, types));
  }
  return db
    .select()
    .from(coachNotebook)
    .where(and(...conditions))
    .orderBy(desc(coachNotebook.updatedAt))
    .limit(100);
}

export async function createNotebookEntry(
  entry: InsertCoachNotebookEntry,
): Promise<CoachNotebookEntry> {
  const [created] = await db.insert(coachNotebook).values(entry).returning();
  return created;
}

const MAX_ENTRY_CONTENT_LENGTH = 500;
const MAX_ENTRIES_PER_BATCH = 10;

export async function createNotebookEntries(
  entries: InsertCoachNotebookEntry[],
): Promise<CoachNotebookEntry[]> {
  if (entries.length === 0) return [];
  // Defense-in-depth: clamp batch size and content length
  const clamped = entries.slice(0, MAX_ENTRIES_PER_BATCH).map((e) => ({
    ...e,
    content: e.content.slice(0, MAX_ENTRY_CONTENT_LENGTH),
  }));
  // M-4 (defense-in-depth): warn when entries arrive without a dedupeKey.
  // Postgres treats NULLs as distinct in unique indexes, so NULL-keyed rows
  // bypass the `onConflictDoNothing` dedup below — every retry inserts a new
  // duplicate. The full fix is a backfill + NOT NULL migration (deferred,
  // see todo session-2026-04-17 M-4); this warn surfaces leaking call sites
  // until that lands. One log per call (not per entry) keeps signal tight.
  const missingDedupeKey = clamped.filter(
    (e) => e.dedupeKey == null || e.dedupeKey === "",
  ).length;
  if (missingDedupeKey > 0) {
    const rawUserId = clamped.find((e) => e.userId)?.userId;
    // M4: hash the userId before logging to avoid PII in log aggregators.
    const userIdHash = rawUserId
      ? createHash("sha256").update(rawUserId).digest("hex").slice(0, 12)
      : undefined;
    logger.warn(
      {
        reason: "coach_notebook.dedupeKey_missing",
        userIdHash,
        missingDedupeKey,
        totalEntries: clamped.length,
      },
      "createNotebookEntries: missing dedupeKey bypasses unique-index dedup; see todo session-2026-04-17 M-4",
    );
  }
  // `dedupeKey` carries a SHA-256 fingerprint of the conversation turn; the
  // unique index makes this insert idempotent when the SSE stream is retried.
  // Rows without a `dedupeKey` (legacy/manual inserts) still insert normally
  // because Postgres treats NULLs as distinct in a unique index.
  const fresh = await refreshRepeats(clamped);
  if (fresh.length === 0) return [];
  return db
    .insert(coachNotebook)
    .values(fresh)
    .onConflictDoNothing()
    .returning();
}

/**
 * Visible memory (spec 2026-11-08): a fact the model extracts again refreshes
 * the existing entry instead of piling up a duplicate, and a fact the user
 * rejected (Undo / Remove) is never re-saved. Returns the entries still to
 * insert. Matching: same user and type, `sameTip` on normalised text.
 */
/**
 * Rows `refreshRepeats` compares against, newest first. Bounds the read so it
 * does not grow with a user's whole notebook history; a fact rejected so long
 * ago that it falls outside the window may be saved again.
 */
export const REPEAT_SCAN_LIMIT = 200;

async function refreshRepeats(
  entries: InsertCoachNotebookEntry[],
): Promise<InsertCoachNotebookEntry[]> {
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const types = [...new Set(entries.map((e) => e.type))];
  const existing = await db
    .select({
      id: coachNotebook.id,
      userId: coachNotebook.userId,
      type: coachNotebook.type,
      content: coachNotebook.content,
      status: coachNotebook.status,
    })
    .from(coachNotebook)
    .where(
      and(
        inArray(coachNotebook.userId, userIds),
        inArray(coachNotebook.type, types),
        inArray(coachNotebook.status, ["active", "rejected"]),
      ),
    )
    .orderBy(desc(coachNotebook.updatedAt))
    .limit(REPEAT_SCAN_LIMIT);
  const toRefresh: number[] = [];
  const fresh: InsertCoachNotebookEntry[] = [];
  for (const entry of entries) {
    const key = insightKey(entry.content);
    const match = existing.find(
      (row) =>
        row.userId === entry.userId &&
        row.type === entry.type &&
        sameTip(insightKey(row.content), key),
    );
    if (!match) fresh.push(entry);
    else if (match.status === "active") toRefresh.push(match.id);
  }
  if (toRefresh.length > 0) {
    await db
      .update(coachNotebook)
      .set({ updatedAt: new Date() })
      .where(inArray(coachNotebook.id, [...new Set(toRefresh)]));
  }
  return fresh;
}

export async function getNotebookEntryById(
  id: number,
  userId: string,
): Promise<CoachNotebookEntry | undefined> {
  const [entry] = await db
    .select()
    .from(coachNotebook)
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)))
    .limit(1);
  return entry;
}

/** Batch form of {@link getNotebookEntryById}; ownership stays in the SQL. */
export async function getNotebookEntriesByIds(
  ids: number[],
  userId: string,
): Promise<CoachNotebookEntry[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(coachNotebook)
    .where(
      and(inArray(coachNotebook.id, ids), eq(coachNotebook.userId, userId)),
    );
}

export async function updateNotebookEntryStatus(
  id: number,
  userId: string,
  status: NotebookEntryStatus,
): Promise<CoachNotebookEntry | undefined> {
  const [updated] = await db
    .update(coachNotebook)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)))
    .returning();
  return updated;
}

export async function getCommitmentsWithDueFollowUp(
  userId: string,
): Promise<CoachNotebookEntry[]> {
  return db
    .select()
    .from(coachNotebook)
    .where(
      and(
        eq(coachNotebook.userId, userId),
        eq(coachNotebook.type, "commitment"),
        eq(coachNotebook.status, "active"),
        lte(coachNotebook.followUpDate, new Date()),
      ),
    )
    .orderBy(desc(coachNotebook.followUpDate));
}

export async function archiveOldEntries(
  userId: string,
  olderThanDays: number,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const result = await db
    .update(coachNotebook)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(coachNotebook.userId, userId),
        eq(coachNotebook.status, "active"),
        // Confirmed entries stay until the user removes them (owner 2026-11-08).
        isNull(coachNotebook.confirmedAt),
        lte(coachNotebook.updatedAt, cutoff),
        or(
          ne(coachNotebook.type, "commitment"),
          isNull(coachNotebook.followUpDate),
          // Same plain instant comparison as getCommitmentsWithDueFollowUp
          // (above) and getDueCommitmentsAllUsers (below) — deliberately
          // left unchanged. It is correct for rows whose followUpDate was
          // anchored properly at write time (coach-pro-chat.ts) — but NOT
          // for rows written through server/routes/notebook.ts's POST/PATCH
          // handlers, which still anchor at UTC midnight (separate defect,
          // out of this todo's scope), nor for pre-fix rows, which retain
          // their original UTC-midnight anchoring. A stricter cutoff here
          // would only widen which "past" commitments get archived a little
          // earlier, which is a different (and lower-stakes) bar than the
          // "does the push fire early" correctness this todo targets.
          lte(coachNotebook.followUpDate, new Date()),
        ),
      ),
    )
    .returning();
  return result.length;
}

export async function getNotebookEntryCount(
  userId: string,
  type: NotebookEntryType,
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coachNotebook)
    .where(
      and(
        eq(coachNotebook.userId, userId),
        eq(coachNotebook.type, type),
        eq(coachNotebook.status, "active"),
      ),
    );
  return result?.count ?? 0;
}

export async function getNotebookEntries(
  userId: string,
  opts?: {
    type?: string;
    status?: string;
    page?: number;
    limit?: number;
  },
): Promise<CoachNotebookEntry[]> {
  const limit = opts?.limit ?? 50;
  const page = opts?.page ?? 1;
  const offset = (page - 1) * limit;
  const conditions = [eq(coachNotebook.userId, userId)];
  if (opts?.type) conditions.push(eq(coachNotebook.type, opts.type));
  if (opts?.status) {
    conditions.push(eq(coachNotebook.status, opts.status));
  } else {
    // Default: exclude archived, and entries the user removed (rejected)
    conditions.push(notInArray(coachNotebook.status, ["archived", "rejected"]));
  }
  return db
    .select()
    .from(coachNotebook)
    .where(and(...conditions))
    .orderBy(
      sql`CASE WHEN ${coachNotebook.status} = 'active' THEN 0 ELSE 1 END`,
      desc(coachNotebook.updatedAt),
    )
    .limit(limit)
    .offset(offset);
}

export async function updateNotebookEntry(
  id: number,
  userId: string,
  updates: {
    content?: string;
    type?: string;
    followUpDate?: Date | null;
    status?: string;
  },
): Promise<CoachNotebookEntry | undefined> {
  // Editing the text is the user's own confirmation; a commitment's label
  // becomes their words (visible memory, spec 2026-11-08).
  const now = new Date();
  const confirmEdit =
    updates.content !== undefined
      ? {
          confirmedAt: now,
          shownAt: now,
          ...(updates.type === "commitment" ||
          (updates.type === undefined && (await isCommitment(id, userId)))
            ? { label: updates.content.slice(0, 120) }
            : {}),
        }
      : {};
  const [updated] = await db
    .update(coachNotebook)
    .set({ ...updates, ...confirmEdit, updatedAt: now })
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)))
    .returning();
  return updated || undefined;
}

async function isCommitment(id: number, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ type: coachNotebook.type })
    .from(coachNotebook)
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)))
    .limit(1);
  return row?.type === "commitment";
}

export async function deleteNotebookEntry(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(coachNotebook)
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)))
    .returning({ id: coachNotebook.id });
  return result.length > 0;
}

/**
 * Fetch all active commitment entries whose followUpDate is in the past
 * (across all users). Used by the notification scheduler to send server-driven
 * push reminders.
 *
 * Returns at most `limit` rows per call, ordered by (followUpDate, id). Pass
 * the last row of the previous page as `after` to fetch the next page — the
 * scheduler pages through ALL due rows, so permanently-undeliverable entries
 * at the head of the queue cannot starve newer users' reminders.
 */
export async function getDueCommitmentsAllUsers(
  limit = 500,
  after?: { followUpDate: Date; id: number },
): Promise<CoachNotebookEntry[]> {
  return db
    .select()
    .from(coachNotebook)
    .where(
      and(
        eq(coachNotebook.type, "commitment"),
        eq(coachNotebook.status, "active"),
        lte(coachNotebook.followUpDate, new Date()),
        after
          ? or(
              gt(coachNotebook.followUpDate, after.followUpDate),
              and(
                eq(coachNotebook.followUpDate, after.followUpDate),
                gt(coachNotebook.id, after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(coachNotebook.followUpDate), asc(coachNotebook.id))
    .limit(limit);
}
