import {
  type WeightLog,
  type InsertWeightLog,
  type ExerciseLog,
  type InsertExerciseLog,
  type ExerciseLibraryEntry,
  type InsertExerciseLibraryEntry,
  type HealthKitSyncEntry,
  weightLogs,
  exerciseLogs,
  exerciseLibrary,
  healthKitSync,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lte, or, ilike } from "drizzle-orm";
import { escapeLike, getDayBounds } from "./helpers";

// ============================================================================
// WEIGHT LOGS
// ============================================================================

export async function getWeightLogs(
  userId: string,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<WeightLog[]> {
  const conditions = [eq(weightLogs.userId, userId)];
  if (options?.from) {
    conditions.push(gte(weightLogs.loggedAt, options.from));
  }
  if (options?.to) {
    conditions.push(lte(weightLogs.loggedAt, options.to));
  }
  const query = db
    .select()
    .from(weightLogs)
    .where(and(...conditions))
    .orderBy(desc(weightLogs.loggedAt));
  if (options?.limit) {
    return query.limit(options.limit);
  }
  return query;
}

export async function createWeightLog(
  log: InsertWeightLog,
): Promise<WeightLog> {
  const [created] = await db.insert(weightLogs).values(log).returning();
  return created;
}

export async function deleteWeightLog(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(weightLogs)
    .where(and(eq(weightLogs.id, id), eq(weightLogs.userId, userId)))
    .returning({ id: weightLogs.id });
  return result.length > 0;
}

export async function getLatestWeight(
  userId: string,
): Promise<WeightLog | undefined> {
  const [latest] = await db
    .select()
    .from(weightLogs)
    .where(eq(weightLogs.userId, userId))
    .orderBy(desc(weightLogs.loggedAt))
    .limit(1);
  return latest;
}

// ============================================================================
// EXERCISE LOGS
// ============================================================================

export async function getExerciseLogs(
  userId: string,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<ExerciseLog[]> {
  const conditions = [eq(exerciseLogs.userId, userId)];
  if (options?.from) conditions.push(gte(exerciseLogs.loggedAt, options.from));
  if (options?.to) conditions.push(lte(exerciseLogs.loggedAt, options.to));
  const query = db
    .select()
    .from(exerciseLogs)
    .where(and(...conditions))
    .orderBy(desc(exerciseLogs.loggedAt));
  if (options?.limit) return query.limit(options.limit);
  return query;
}

export async function createExerciseLog(
  log: InsertExerciseLog,
): Promise<ExerciseLog> {
  const [created] = await db.insert(exerciseLogs).values(log).returning();
  return created;
}

export async function updateExerciseLog(
  id: number,
  userId: string,
  updates: Partial<InsertExerciseLog>,
): Promise<ExerciseLog | undefined> {
  const [updated] = await db
    .update(exerciseLogs)
    .set(updates)
    .where(and(eq(exerciseLogs.id, id), eq(exerciseLogs.userId, userId)))
    .returning();
  return updated;
}

export async function deleteExerciseLog(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(exerciseLogs)
    .where(and(eq(exerciseLogs.id, id), eq(exerciseLogs.userId, userId)))
    .returning({ id: exerciseLogs.id });
  return result.length > 0;
}

export async function getExerciseDailySummary(
  userId: string,
  date: Date,
): Promise<{
  totalCaloriesBurned: number;
  totalMinutes: number;
  exerciseCount: number;
}> {
  const { startOfDay, endOfDay } = getDayBounds(date);
  const logs = await db
    .select()
    .from(exerciseLogs)
    .where(
      and(
        eq(exerciseLogs.userId, userId),
        gte(exerciseLogs.loggedAt, startOfDay),
        lte(exerciseLogs.loggedAt, endOfDay),
      ),
    );
  return {
    totalCaloriesBurned: logs.reduce(
      (sum, l) => sum + (l.caloriesBurned ? parseFloat(l.caloriesBurned) : 0),
      0,
    ),
    totalMinutes: logs.reduce((sum, l) => sum + l.durationMinutes, 0),
    exerciseCount: logs.length,
  };
}

// ============================================================================
// EXERCISE LIBRARY
// ============================================================================

export async function searchExerciseLibrary(
  query: string,
  userId?: string,
): Promise<ExerciseLibraryEntry[]> {
  const searchTerm = `%${escapeLike(query)}%`;
  return db
    .select()
    .from(exerciseLibrary)
    .where(
      and(
        ilike(exerciseLibrary.name, searchTerm),
        or(
          eq(exerciseLibrary.isCustom, false),
          userId ? eq(exerciseLibrary.userId, userId) : undefined,
        ),
      ),
    )
    .limit(20);
}

export async function createExerciseLibraryEntry(
  entry: InsertExerciseLibraryEntry,
): Promise<ExerciseLibraryEntry> {
  const [created] = await db.insert(exerciseLibrary).values(entry).returning();
  return created;
}

// ============================================================================
// HEALTHKIT SYNC
// ============================================================================

export async function getHealthKitSyncSettings(
  userId: string,
): Promise<HealthKitSyncEntry[]> {
  return db
    .select()
    .from(healthKitSync)
    .where(eq(healthKitSync.userId, userId));
}

export async function upsertHealthKitSyncSetting(
  userId: string,
  dataType: string,
  enabled: boolean,
  syncDirection?: string,
): Promise<HealthKitSyncEntry> {
  const [result] = await db
    .insert(healthKitSync)
    .values({
      userId,
      dataType,
      enabled,
      syncDirection: syncDirection ?? "read",
    })
    .onConflictDoUpdate({
      target: [healthKitSync.userId, healthKitSync.dataType],
      set: {
        enabled,
        ...(syncDirection ? { syncDirection } : {}),
      },
    })
    .returning();
  return result;
}

export async function updateHealthKitLastSync(
  userId: string,
  dataType: string,
): Promise<void> {
  await db
    .update(healthKitSync)
    .set({ lastSyncAt: new Date() })
    .where(
      and(
        eq(healthKitSync.userId, userId),
        eq(healthKitSync.dataType, dataType),
      ),
    );
}
