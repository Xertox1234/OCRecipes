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
import { eq, and, desc, lte, sql, inArray } from "drizzle-orm";

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

export async function createNotebookEntries(
  entries: InsertCoachNotebookEntry[],
): Promise<CoachNotebookEntry[]> {
  if (entries.length === 0) return [];
  return db.insert(coachNotebook).values(entries).returning();
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
