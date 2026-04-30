/**
 * Server-driven commitment reminder scheduler.
 *
 * Runs a cron job at 09:00 server-local time every day. For each active
 * commitment notebook entry whose followUpDate is today or in the past, sends
 * a push notification to all registered devices for that user.
 *
 * The job is idempotent: it will not send duplicate notifications because each
 * commitment entry has at most one followUpDate and the query only returns
 * entries where followUpDate <= now. After sending, the entry status is updated
 * to "completed" so it won't be picked up again on the next run.
 *
 * Graceful degradation: if EXPO_ACCESS_TOKEN is not set, or the user has no
 * registered push tokens, sendPushToUser returns false and the entry is NOT
 * marked "completed" — the in-app indicator and local notification fallback
 * (useNotebookNotifications) continue to serve the reminder. Entries are only
 * marked completed after at least one push is confirmed delivered by Expo.
 *
 * Usage: call startNotificationScheduler() once at server startup.
 */
import cron from "node-cron";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { sendPushToUser } from "./push-notifications";

/** Fire the reminder batch for all due commitments. Exported for testing. */
export async function sendDueCommitmentReminders(): Promise<void> {
  let entries;
  try {
    entries = await storage.getDueCommitmentsAllUsers();
  } catch (err) {
    logger.error(
      { err },
      "notification-scheduler: failed to fetch due commitments",
    );
    return;
  }

  if (entries.length === 0) return;

  logger.info(
    { count: entries.length },
    "notification-scheduler: sending commitment reminders",
  );

  for (const entry of entries) {
    try {
      const delivered = await sendPushToUser(
        entry.userId,
        "Coach reminder",
        entry.content.slice(0, 100),
        { entryId: entry.id },
      );

      if (delivered) {
        // Mark entry completed only after confirmed delivery so the in-app
        // indicator (and future local notification fallback) still triggers
        // if push delivery was not attempted (no client or no token).
        await storage.updateNotebookEntryStatus(
          entry.id,
          entry.userId,
          "completed",
        );
      }
    } catch (err) {
      logger.error(
        { err, entryId: entry.id },
        "notification-scheduler: failed to send reminder for entry",
      );
    }
  }
}

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start the daily 09:00 cron job that sends commitment reminders.
 * Safe to call multiple times — only one job instance is created.
 */
export function startNotificationScheduler(): void {
  if (scheduledTask) return;

  // "0 9 * * *" = every day at 09:00 server time
  scheduledTask = cron.schedule("0 9 * * *", () => {
    sendDueCommitmentReminders().catch((err) => {
      logger.error(
        { err },
        "notification-scheduler: unhandled error in cron job",
      );
    });
  });

  logger.info("notification-scheduler: started (daily at 09:00)");
}

/** Stop the scheduler (used in tests). */
export function stopNotificationScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}
