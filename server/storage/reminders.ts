import { pendingReminders } from "@shared/schema";
import type { CoachContextItem, ReminderType } from "@shared/types/reminders";
import { db } from "../db";
import { and, eq, isNull, gte, lt } from "drizzle-orm";
import { getDayBounds } from "./helpers";

export async function createPendingReminder(data: {
  userId: string;
  type: ReminderType;
  context: Record<string, unknown>;
  scheduledFor: Date;
}): Promise<void> {
  await db.insert(pendingReminders).values(data);
}

export async function hasPendingReminderToday(
  userId: string,
  type: ReminderType,
): Promise<boolean> {
  const { startOfDay, endOfDay } = getDayBounds(new Date());
  const [existing] = await db
    .select({ id: pendingReminders.id })
    .from(pendingReminders)
    .where(
      and(
        eq(pendingReminders.userId, userId),
        eq(pendingReminders.type, type),
        isNull(pendingReminders.acknowledgedAt),
        gte(pendingReminders.scheduledFor, startOfDay),
        lt(pendingReminders.scheduledFor, endOfDay),
      ),
    )
    .limit(1);
  return !!existing;
}

export async function hasPendingReminders(userId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: pendingReminders.id })
    .from(pendingReminders)
    .where(
      and(
        eq(pendingReminders.userId, userId),
        isNull(pendingReminders.acknowledgedAt),
      ),
    )
    .limit(1);
  return !!existing;
}

export async function acknowledgeReminders(
  userId: string,
): Promise<CoachContextItem[]> {
  // Single atomic UPDATE ... RETURNING to avoid TOCTOU race where two concurrent
  // calls could both SELECT the same pending rows before either UPDATE runs.
  // PostgreSQL guarantees each row is updated exactly once across concurrent calls.
  const acknowledged = await db
    .update(pendingReminders)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        eq(pendingReminders.userId, userId),
        isNull(pendingReminders.acknowledgedAt),
      ),
    )
    .returning();

  // The context shape is guaranteed by createPendingReminder callers
  // (notification-scheduler.ts) which always pass the correct fields for each type.
  return acknowledged.map((r) => ({
    type: r.type,
    ...r.context,
  })) as CoachContextItem[];
}
