import { notificationSends } from "@shared/schema";
import { db } from "../db";
import { and, eq, desc } from "drizzle-orm";

/**
 * Record one discretionary notification send. Idempotent per (user, category,
 * UTC calendar day) via notification_sends_user_category_day_idx — a re-run the
 * same day is a no-op.
 */
export async function recordNotificationSend(data: {
  userId: string;
  category: string;
  sentAt: Date;
}): Promise<void> {
  await db.insert(notificationSends).values(data).onConflictDoNothing();
}

/** Latest sentAt for a user+category, or null if none (winback cooldown lookup). */
export async function getLastNotificationSend(
  userId: string,
  category: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ sentAt: notificationSends.sentAt })
    .from(notificationSends)
    .where(
      and(
        eq(notificationSends.userId, userId),
        eq(notificationSends.category, category),
      ),
    )
    .orderBy(desc(notificationSends.sentAt))
    .limit(1);
  return row?.sentAt ?? null;
}
