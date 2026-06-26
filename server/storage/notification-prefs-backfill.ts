import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * One-shot Phase 0 backfill: stage notificationPrefs from reminderMutes for every
 * user_profiles row whose notificationPrefs is still the empty default. categories
 * is a verbatim copy of reminder_mutes (muted-boolean semantics) — no inversion, no
 * key rename. Idempotent: only touches rows where notification_prefs = '{}'.
 */
export async function backfillNotificationPrefs(): Promise<void> {
  await db.execute(sql`
    UPDATE user_profiles
    SET notification_prefs = jsonb_build_object(
      'categories', reminder_mutes,
      'quietHours', jsonb_build_object('start', '21:00', 'end', '08:00'),
      'ambientPush', false,
      'transactionalEnabled', true
    )
    WHERE notification_prefs = '{}'::jsonb
  `);
}
