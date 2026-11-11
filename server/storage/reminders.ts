import { pendingReminders } from "@shared/schema";
import type { CoachContextItem, ReminderType } from "@shared/types/reminders";
import { coachContextItemSchema } from "@shared/schemas/reminders";
import { db } from "../db";
import { logger } from "../lib/logger";
import { and, desc, eq, isNull, gte, lt } from "drizzle-orm";
import { getDayBounds } from "./helpers";

export async function createPendingReminder(data: {
  userId: string;
  type: ReminderType;
  context: Record<string, unknown>;
  scheduledFor: Date;
}): Promise<void> {
  // DB unique index is the authoritative dedup guard for concurrent scheduler runs.
  await db.insert(pendingReminders).values(data).onConflictDoNothing();
}

export async function hasPendingReminderToday(
  userId: string,
  type: ReminderType,
  tz: string = "UTC",
): Promise<boolean> {
  const { startOfDay, endOfDay } = getDayBounds(new Date(), tz);
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

  return parseReminderRows(acknowledged);
}

/** Row context → validated item. Explicit `type` last so the row's type wins. */
function parseReminderRows(
  rows: { id: number; type: ReminderType; context: Record<string, unknown> }[],
): CoachContextItem[] {
  return rows
    .map((r) => {
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

/**
 * Today's unacknowledged reminders (the user's local day), newest first —
 * read only. The opening brief shows the reason for the Coach tab dot from
 * this; clearing stays with `acknowledgeReminders`, when the user acts.
 */
export async function getTodaysPendingReminders(
  userId: string,
  tz: string,
  now: Date = new Date(),
): Promise<CoachContextItem[]> {
  const { startOfDay, endOfDay } = getDayBounds(now, tz);
  const rows = await db
    .select({
      id: pendingReminders.id,
      type: pendingReminders.type,
      context: pendingReminders.context,
    })
    .from(pendingReminders)
    .where(
      and(
        eq(pendingReminders.userId, userId),
        isNull(pendingReminders.acknowledgedAt),
        gte(pendingReminders.scheduledFor, startOfDay),
        lt(pendingReminders.scheduledFor, endOfDay),
      ),
    )
    .orderBy(desc(pendingReminders.scheduledFor));
  return parseReminderRows(rows);
}

/**
 * Clear only one reminder type for the user (the brief's "Not today" on a
 * missed meal must not also clear a commitment reminder). Returns the count.
 */
export async function acknowledgeReminderType(
  userId: string,
  type: ReminderType,
): Promise<number> {
  const rows = await db
    .update(pendingReminders)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        eq(pendingReminders.userId, userId),
        eq(pendingReminders.type, type),
        isNull(pendingReminders.acknowledgedAt),
      ),
    )
    .returning({ id: pendingReminders.id });
  return rows.length;
}

/**
 * Whether a reminder of `type` was scheduled at or after `since`, acknowledged
 * or not. The weekly report uses it to hold its push until the next morning
 * when a commitment push already went out that local day.
 */
export async function hasReminderSince(
  userId: string,
  type: ReminderType,
  since: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: pendingReminders.id })
    .from(pendingReminders)
    .where(
      and(
        eq(pendingReminders.userId, userId),
        eq(pendingReminders.type, type),
        gte(pendingReminders.scheduledFor, since),
      ),
    )
    .limit(1);
  return !!row;
}
