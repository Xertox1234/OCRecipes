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

/**
 * Take the day's one slot for a user+category BEFORE sending. True when this
 * call took it; false when a send that UTC day already holds it (the same
 * notification_sends_user_category_day_idx). The claim is kept even if the
 * send then fails, so a broken push cannot be retried into a second one.
 */
export async function claimNotificationSend(data: {
  userId: string;
  category: string;
  sentAt: Date;
}): Promise<boolean> {
  const rows = await db
    .insert(notificationSends)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: notificationSends.id });
  return rows.length > 0;
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
