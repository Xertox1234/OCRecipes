import { pendingReminders } from "@shared/schema";
import type { CoachContextItem, ReminderType } from "@shared/types/reminders";
import { coachContextItemSchema } from "@shared/schemas/reminders";
import { db } from "../db";
import { logger } from "../lib/logger";
import { and, eq, isNull, gte, lt } from "drizzle-orm";
import { getDayBounds } from "./helpers";

export async function createPendingReminder(data: {
  userId: string;
  type: ReminderType;
  context: Record<string, unknown>;
  scheduledFor: Date;
}): Promise<void> {
  // onConflictDoNothing makes the insert idempotent: if a pending reminder for
  // the same user+type on the same calendar day already exists (enforced by
  // pending_reminders_user_type_day_idx), the insert is silently skipped.
  // This prevents duplicates under concurrent scheduler runs without needing a
  // separate hasPendingReminderToday() check-before-insert.
  await db.insert(pendingReminders).values(data).onConflictDoNothing();
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

  return acknowledged
    .map((r) => {
      // Explicit type last so r.type always wins over any stray "type" key in context
      const result = coachContextItemSchema.safeParse({
        ...r.context,
        type: r.type,
      });
      if (!result.success) {
        logger.warn(
          { rowId: r.id },
          "reminders: malformed context JSONB — skipping",
        );
        return null;
      }
      return result.data;
    })
    .filter((item): item is CoachContextItem => item !== null);
}
