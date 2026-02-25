import {
  type MedicationLog,
  type InsertMedicationLog,
  type GoalAdjustmentLog,
  type InsertGoalAdjustmentLog,
  medicationLogs,
  goalAdjustmentLogs,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lte } from "drizzle-orm";

// ============================================================================
// MEDICATION LOGS (GLP-1)
// ============================================================================

export async function getMedicationLogs(
  userId: string,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<MedicationLog[]> {
  const conditions = [eq(medicationLogs.userId, userId)];
  if (options?.from) conditions.push(gte(medicationLogs.takenAt, options.from));
  if (options?.to) conditions.push(lte(medicationLogs.takenAt, options.to));
  return db
    .select()
    .from(medicationLogs)
    .where(and(...conditions))
    .orderBy(desc(medicationLogs.takenAt))
    .limit(options?.limit || 50);
}

export async function createMedicationLog(
  log: InsertMedicationLog,
): Promise<MedicationLog> {
  const [result] = await db.insert(medicationLogs).values(log).returning();
  return result;
}

export async function updateMedicationLog(
  id: number,
  userId: string,
  updates: Partial<InsertMedicationLog>,
): Promise<MedicationLog | undefined> {
  const [result] = await db
    .update(medicationLogs)
    .set(updates)
    .where(and(eq(medicationLogs.id, id), eq(medicationLogs.userId, userId)))
    .returning();
  return result || undefined;
}

export async function deleteMedicationLog(
  id: number,
  userId: string,
): Promise<boolean> {
  const [deleted] = await db
    .delete(medicationLogs)
    .where(and(eq(medicationLogs.id, id), eq(medicationLogs.userId, userId)))
    .returning({ id: medicationLogs.id });
  return !!deleted;
}

// ============================================================================
// GOAL ADJUSTMENT LOGS (Adaptive Goals)
// ============================================================================

export async function createGoalAdjustmentLog(
  log: InsertGoalAdjustmentLog,
): Promise<GoalAdjustmentLog> {
  const [result] = await db.insert(goalAdjustmentLogs).values(log).returning();
  return result;
}

export async function getGoalAdjustmentLogs(
  userId: string,
  limit?: number,
): Promise<GoalAdjustmentLog[]> {
  const query = db
    .select()
    .from(goalAdjustmentLogs)
    .where(eq(goalAdjustmentLogs.userId, userId))
    .orderBy(desc(goalAdjustmentLogs.appliedAt));
  if (limit) {
    return query.limit(limit);
  }
  return query;
}
