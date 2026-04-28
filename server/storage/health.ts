import {
  type WeightLog,
  type InsertWeightLog,
  type HealthKitSyncEntry,
  weightLogs,
  healthKitSync,
  users,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

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
  const effectiveLimit = options?.limit ?? 100;
  return db
    .select()
    .from(weightLogs)
    .where(and(...conditions))
    .orderBy(desc(weightLogs.loggedAt))
    .limit(effectiveLimit);
}

/** Upsert a weight log, enforcing one entry per user per calendar day. */
export async function createWeightLog(
  log: InsertWeightLog,
): Promise<WeightLog> {
  // The unique index keys on (user_id, DATE(logged_at)) -- a functional index
  // that Drizzle's typed `target:` array cannot reference directly.
  // Use raw SQL so PostgreSQL resolves the conflict against the expression index.
  const result = await db.execute<WeightLog>(
    sql`INSERT INTO weight_logs (user_id, weight, unit, source, note)
        VALUES (
          ${log.userId},
          ${log.weight},
          ${log.unit ?? "lb"},
          ${log.source ?? "manual"},
          ${log.note ?? null}
        )
        ON CONFLICT (user_id, DATE(logged_at))
        DO UPDATE SET
          weight = EXCLUDED.weight,
          unit   = EXCLUDED.unit,
          source = EXCLUDED.source,
          note   = EXCLUDED.note
        RETURNING *`,
  );
  return result.rows[0] as WeightLog;
}

/** Create weight log and update user's current weight atomically */
export async function createWeightLogAndUpdateUser(
  log: InsertWeightLog,
): Promise<WeightLog> {
  return db.transaction(async (tx) => {
    const result = await tx.execute<WeightLog>(
      sql`INSERT INTO weight_logs (user_id, weight, unit, source, note)
          VALUES (
            ${log.userId},
            ${log.weight},
            ${log.unit ?? "lb"},
            ${log.source ?? "manual"},
            ${log.note ?? null}
          )
          ON CONFLICT (user_id, DATE(logged_at))
          DO UPDATE SET
            weight = EXCLUDED.weight,
            unit   = EXCLUDED.unit,
            source = EXCLUDED.source,
            note   = EXCLUDED.note
          RETURNING *`,
    );
    const created = result.rows[0] as WeightLog;
    await tx
      .update(users)
      .set({ weight: log.weight })
      .where(eq(users.id, log.userId));
    return created;
  });
}

/** Delete weight log and update user's current weight to the latest remaining log */
export async function deleteWeightLog(
  id: number,
  userId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const result = await tx
      .delete(weightLogs)
      .where(and(eq(weightLogs.id, id), eq(weightLogs.userId, userId)))
      .returning({ id: weightLogs.id });
    if (result.length === 0) return false;

    // Revert users.weight to the latest remaining log (or null if none)
    const [latest] = await tx
      .select({ weight: weightLogs.weight })
      .from(weightLogs)
      .where(eq(weightLogs.userId, userId))
      .orderBy(desc(weightLogs.loggedAt))
      .limit(1);
    await tx
      .update(users)
      .set({ weight: latest?.weight ?? null })
      .where(eq(users.id, userId));
    return true;
  });
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
