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
import type { ReminderMutes } from "@shared/types/reminders";

function isMuted(
  mutes: ReminderMutes | null | undefined,
  type: keyof ReminderMutes,
): boolean {
  return !!mutes?.[type];
}

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

  // Fetch each user's profile once (not once per entry) to avoid redundant DB
  // round-trips when a user has multiple due commitments.
  const uniqueUserIds = [...new Set(entries.map((e) => e.userId))];
  let profileMap: Map<
    string,
    Awaited<ReturnType<typeof storage.getUserProfile>>
  >;
  try {
    profileMap = new Map(
      await Promise.all(
        uniqueUserIds.map(
          async (id) => [id, await storage.getUserProfile(id)] as const,
        ),
      ),
    );
  } catch (err) {
    logger.error(
      { err },
      "notification-scheduler: failed to batch-fetch user profiles",
    );
    return;
  }

  for (const entry of entries) {
    try {
      const profile = profileMap.get(entry.userId);
      if (isMuted(profile?.reminderMutes, "commitment")) continue;

      // Write pending reminder (regardless of push success)
      const alreadyPending = await storage.hasPendingReminderToday(
        entry.userId,
        "commitment",
      );
      if (!alreadyPending) {
        await storage.createPendingReminder({
          userId: entry.userId,
          type: "commitment",
          context: {
            notebookEntryId: entry.id,
            content: entry.content.slice(0, 200),
          },
          scheduledFor: new Date(),
        });
      }

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
        "notification-scheduler: failed to process commitment entry",
      );
    }
  }
}

/** Create a daily check-in pending reminder for each unmuted user. */
export async function sendDailyCheckinReminders(): Promise<void> {
  let userIds: string[];
  try {
    userIds = await storage.getAllUserIds();
  } catch (err) {
    logger.error(
      { err },
      "notification-scheduler: failed to fetch user IDs for daily checkin",
    );
    return;
  }

  for (const userId of userIds) {
    try {
      const profile = await storage.getUserProfile(userId);
      if (isMuted(profile?.reminderMutes, "daily-checkin")) continue;

      const alreadyPending = await storage.hasPendingReminderToday(
        userId,
        "daily-checkin",
      );
      if (alreadyPending) continue;

      const summary = await storage.getDailySummary(userId, new Date());

      await storage.createPendingReminder({
        userId,
        type: "daily-checkin",
        context: { calories: Math.round(summary.totalCalories) },
        scheduledFor: new Date(),
      });
    } catch (err) {
      logger.error(
        { err, userId },
        "notification-scheduler: failed daily-checkin reminder for user",
      );
    }
  }
}

/** Create a meal-log pending reminder for users who have no logs today. */
export async function sendMealLogReminders(): Promise<void> {
  let userIds: string[];
  try {
    userIds = await storage.getAllUserIds();
  } catch (err) {
    logger.error(
      { err },
      "notification-scheduler: failed to fetch user IDs for meal-log reminders",
    );
    return;
  }

  for (const userId of userIds) {
    try {
      const profile = await storage.getUserProfile(userId);
      if (isMuted(profile?.reminderMutes, "meal-log")) continue;

      const logs = await storage.getDailyLogs(userId, new Date());
      if (logs.length > 0) continue;

      const alreadyPending = await storage.hasPendingReminderToday(
        userId,
        "meal-log",
      );
      if (alreadyPending) continue;

      await storage.createPendingReminder({
        userId,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date(),
      });
    } catch (err) {
      logger.error(
        { err, userId },
        "notification-scheduler: failed meal-log reminder for user",
      );
    }
  }
}

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;
let mealLogTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start the daily cron jobs that send reminders.
 * Safe to call multiple times — only one set of job instances is created.
 */
export function startNotificationScheduler(): void {
  if (scheduledTask || mealLogTask) return;

  // 09:00 daily — commitments + daily check-in
  scheduledTask = cron.schedule("0 9 * * *", () => {
    sendDueCommitmentReminders().catch((err) => {
      logger.error(
        { err },
        "notification-scheduler: unhandled error in commitment cron",
      );
    });
    sendDailyCheckinReminders().catch((err) => {
      logger.error(
        { err },
        "notification-scheduler: unhandled error in daily-checkin cron",
      );
    });
  });

  // 12:00 daily — meal-log nudge for users who haven't logged anything yet today
  mealLogTask = cron.schedule("0 12 * * *", () => {
    sendMealLogReminders().catch((err) => {
      logger.error(
        { err },
        "notification-scheduler: unhandled error in meal-log cron",
      );
    });
  });

  logger.info(
    "notification-scheduler: started (09:00 commitments+checkin, 12:00 meal-log)",
  );
}

/** Stop the scheduler (used in tests). */
export function stopNotificationScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  if (mealLogTask) {
    mealLogTask.stop();
    mealLogTask = null;
  }
}
