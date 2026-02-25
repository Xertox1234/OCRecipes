import {
  type FastingSchedule,
  type InsertFastingSchedule,
  type FastingLog,
  type InsertFastingLog,
  fastingSchedules,
  fastingLogs,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, isNull } from "drizzle-orm";

// ============================================================================
// FASTING
// ============================================================================

export async function getFastingSchedule(
  userId: string,
): Promise<FastingSchedule | undefined> {
  const [schedule] = await db
    .select()
    .from(fastingSchedules)
    .where(eq(fastingSchedules.userId, userId));
  return schedule || undefined;
}

export async function upsertFastingSchedule(
  userId: string,
  schedule: Omit<InsertFastingSchedule, "userId">,
): Promise<FastingSchedule> {
  const [result] = await db
    .insert(fastingSchedules)
    .values({ userId, ...schedule })
    .onConflictDoUpdate({
      target: [fastingSchedules.userId],
      set: schedule,
    })
    .returning();
  return result;
}

export async function getActiveFastingLog(
  userId: string,
): Promise<FastingLog | undefined> {
  const [active] = await db
    .select()
    .from(fastingLogs)
    .where(and(eq(fastingLogs.userId, userId), isNull(fastingLogs.endedAt)));
  return active || undefined;
}

export async function getFastingLogs(
  userId: string,
  limit = 30,
): Promise<FastingLog[]> {
  return db
    .select()
    .from(fastingLogs)
    .where(eq(fastingLogs.userId, userId))
    .orderBy(desc(fastingLogs.startedAt))
    .limit(limit);
}

export async function createFastingLog(
  log: InsertFastingLog,
): Promise<FastingLog> {
  const [created] = await db.insert(fastingLogs).values(log).returning();
  return created;
}

export async function endFastingLog(
  id: number,
  userId: string,
  endedAt: Date,
  actualDurationMinutes: number,
  completed: boolean,
  note?: string,
): Promise<FastingLog | undefined> {
  const [updated] = await db
    .update(fastingLogs)
    .set({ endedAt, actualDurationMinutes, completed, note })
    .where(and(eq(fastingLogs.id, id), eq(fastingLogs.userId, userId)))
    .returning();
  return updated || undefined;
}
