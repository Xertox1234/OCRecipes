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
import { eq, and, desc, lte, sql, inArray, isNull, ne, or } from "drizzle-orm";
import { createHash } from "crypto";

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
  return db
    .insert(coachNotebook)
    .values(clamped)
    .onConflictDoNothing({ target: coachNotebook.dedupeKey })
    .returning();
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
        lte(coachNotebook.updatedAt, cutoff),
        or(
          ne(coachNotebook.type, "commitment"),
          isNull(coachNotebook.followUpDate),
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
    // Default: exclude archived
    conditions.push(ne(coachNotebook.status, "archived"));
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
  const [updated] = await db
    .update(coachNotebook)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)))
    .returning();
  return updated || undefined;
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
 * Returns at most `limit` rows per invocation to bound the scheduler's work.
 */
export async function getDueCommitmentsAllUsers(
  limit = 500,
): Promise<CoachNotebookEntry[]> {
  return db
    .select()
    .from(coachNotebook)
    .where(
      and(
        eq(coachNotebook.type, "commitment"),
        eq(coachNotebook.status, "active"),
        lte(coachNotebook.followUpDate, new Date()),
      ),
    )
    .orderBy(coachNotebook.followUpDate)
    .limit(limit);
}
