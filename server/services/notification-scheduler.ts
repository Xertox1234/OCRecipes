/**
 * Server-driven commitment reminder scheduler.
 *
 * Runs a cron job at 09:00 UTC every day. For each active
 * commitment notebook entry whose followUpDate is today or in the past, sends
 * a push notification to all registered devices for that user.
 *
 * The job is idempotent: it will not send duplicate notifications because each
 * commitment entry has at most one followUpDate and the query only returns
 * entries where followUpDate <= now. After sending, the entry status is updated
 * to "completed" so it won't be picked up again on the next run.
 *
 * Graceful degradation: if EXPO_ACCESS_TOKEN is not set, or the user has no
 * registered push tokens, the push fails (notify() returns pushDelivered:
 * false) and the entry is NOT marked "completed" — the in-app indicator and
 * local notification fallback (useNotebookNotifications) continue to serve the
 * reminder. Entries are only marked completed after at least one push is
 * confirmed delivered by Expo.
 *
 * Usage: call startNotificationScheduler() once at server startup.
 */
import cron from "node-cron";
import pLimit from "p-limit";
import { logger, toError } from "../lib/logger";
import { reportError } from "../lib/error-reporter";
import { storage } from "../storage";
import { civilHourInTz, parseTimezone } from "../lib/civil-date";
import { notify } from "./notifications/notify";
import type { ReminderMutes } from "@shared/types/reminders";

/**
 * Max number of per-user reminder tasks processed concurrently. Bounds DB
 * round-trips so a 500-user page runs in ~50 rounds of 10 rather than 500
 * serial awaits, without unbounded `Promise.all` overwhelming the connection
 * pool. Idempotency is enforced by the `pending_reminders_user_type_day_idx`
 * unique index (createPendingReminder uses onConflictDoNothing), so parallel
 * execution cannot create duplicate reminders.
 */
const REMINDER_CONCURRENCY = 10;

function isMuted(
  mutes: ReminderMutes | null | undefined,
  type: keyof ReminderMutes,
): boolean {
  return !!mutes?.[type];
}

/**
 * Run `task` for each item with at most `REMINDER_CONCURRENCY` in flight.
 * Each task is awaited via Promise.all; callers must keep their own try/catch
 * inside `task` so one user's failure never rejects the whole batch.
 */
async function runBounded<T>(
  items: readonly T[],
  task: (item: T) => Promise<void>,
): Promise<void> {
  const limit = pLimit(REMINDER_CONCURRENCY);
  await Promise.all(items.map((item) => limit(() => task(item))));
}

const DUE_COMMITMENT_PAGE_SIZE = 500;

/**
 * Fire the reminder batch for all due commitments, page by page. Paging (not
 * one capped fetch) matters: undelivered entries stay "active", so a single
 * oldest-first page could fill up with permanently-undeliverable rows and
 * starve every newer user's reminder. Exported for testing.
 */
export async function sendDueCommitmentReminders(): Promise<void> {
  let after: { followUpDate: Date; id: number } | undefined;
  while (true) {
    let entries;
    try {
      entries = await storage.getDueCommitmentsAllUsers(
        DUE_COMMITMENT_PAGE_SIZE,
        after,
      );
    } catch (err) {
      logger.error(
        { err },
        "notification-scheduler: failed to fetch due commitments",
      );
      return;
    }
    if (entries.length === 0) return;

    await sendCommitmentReminderPage(entries);

    const last = entries[entries.length - 1];
    if (entries.length < DUE_COMMITMENT_PAGE_SIZE || !last.followUpDate) {
      return;
    }
    after = { followUpDate: last.followUpDate, id: last.id };
  }
}

async function sendCommitmentReminderPage(
  entries: Awaited<ReturnType<typeof storage.getDueCommitmentsAllUsers>>,
): Promise<void> {
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

  await runBounded(entries, async (entry) => {
    try {
      const profile = profileMap.get(entry.userId);
      if (isMuted(profile?.reminderMutes, "commitment")) return;

      const { pushDelivered } = await notify(entry.userId, "commitment", {
        title: "Coach reminder",
        body: entry.content.slice(0, 100),
        // `url` is what client/navigation/linking.ts's getInitialURL/subscribe
        // resolve a notification tap through. `entryId` stays alongside it —
        // the same shape client/hooks/useNotebookNotifications.ts already
        // sends — for back-compat with the entryId-only fallback there.
        data: {
          entryId: entry.id,
          url: `ocrecipes://notebook-entry/${entry.id}`,
        },
        context: {
          notebookEntryId: entry.id,
          content: entry.content.slice(0, 200),
        },
      });

      if (pushDelivered) {
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
  });
}

/**
 * Options for the per-user local-time reminders. With `localHour` set, only
 * users whose wall-clock hour (in their stored IANA tz, NULL/invalid → UTC)
 * equals `localHour` at `now` are processed — the scheduler runs these hourly
 * so each user gets the nudge at their own local time, not the server's.
 * Without `localHour`, every user is processed (manual/test invocation).
 */
export interface LocalHourReminderOptions {
  now?: Date;
  localHour?: number;
}

/** Local hour each per-user reminder is delivered at. */
export const DAILY_CHECKIN_LOCAL_HOUR = 9;
export const MEAL_LOG_LOCAL_HOUR = 12;

/**
 * Iterate all user IDs in cursor-based pages (500 at a time) and invoke
 * `processPage` with each full page. Keeps the scheduler's heap footprint
 * bounded regardless of user count by never loading all IDs at once.
 *
 * Throws on any page fetch failure; callers should catch and return.
 */
async function forEachUserPaged(
  processPage: (userIds: string[]) => Promise<void>,
): Promise<void> {
  const PAGE_SIZE = 500;
  let cursor: string | null = null;

  while (true) {
    const page = await storage.getUserIdPage(cursor, PAGE_SIZE);
    if (page.length === 0) break;

    await processPage(page);

    cursor = page[page.length - 1];
    if (page.length < PAGE_SIZE) break;
  }
}

function filterByLocalHour(
  userIds: string[],
  tzMap: Map<string, string | null>,
  now: Date,
  localHour: number | undefined,
): string[] {
  if (localHour === undefined) return userIds;
  return userIds.filter(
    (id) => civilHourInTz(now, parseTimezone(tzMap.get(id))) === localHour,
  );
}

/** Create a daily check-in pending reminder for each unmuted user. */
export async function sendDailyCheckinReminders(
  opts: LocalHourReminderOptions = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  try {
    await forEachUserPaged(async (pageUserIds) => {
      // Batch-fetch profiles for the whole page to avoid N sequential queries.
      let profileMap: Map<
        string,
        Awaited<ReturnType<typeof storage.getUserProfile>>
      >;
      let tzMap: Map<string, string | null>;
      let userIds: string[];
      try {
        // Timezones first so the profile batch only covers users who are
        // actually due this hour.
        tzMap = await storage.getUserTimezones(pageUserIds);
        userIds = filterByLocalHour(pageUserIds, tzMap, now, opts.localHour);
        if (userIds.length === 0) return;
        profileMap = new Map(
          await Promise.all(
            userIds.map(
              async (id) => [id, await storage.getUserProfile(id)] as const,
            ),
          ),
        );
      } catch (err) {
        logger.error(
          { err },
          "notification-scheduler: failed to batch-fetch profiles for daily-checkin page",
        );
        return;
      }

      await runBounded(userIds, async (userId) => {
        try {
          const profile = profileMap.get(userId);
          if (isMuted(profile?.reminderMutes, "daily-checkin")) return;

          // Day-bucket in the user's stored timezone (NULL/invalid → "UTC").
          const tz = parseTimezone(tzMap.get(userId));
          const summary = await storage.getDailySummary(userId, now, tz);

          await notify(userId, "daily-checkin", {
            context: { calories: Math.round(summary.totalCalories) },
          });
        } catch (err) {
          logger.error(
            { err, userId },
            "notification-scheduler: failed daily-checkin reminder for user",
          );
        }
      });
    });
  } catch (err) {
    logger.error(
      { err },
      "notification-scheduler: failed to fetch user IDs for daily checkin",
    );
  }
}

/** Create a meal-log pending reminder for users who have no logs today. */
export async function sendMealLogReminders(
  opts: LocalHourReminderOptions = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  try {
    await forEachUserPaged(async (pageUserIds) => {
      // Batch-fetch profiles for the whole page to avoid N sequential queries.
      let profileMap: Map<
        string,
        Awaited<ReturnType<typeof storage.getUserProfile>>
      >;
      let tzMap: Map<string, string | null>;
      let userIds: string[];
      try {
        // Timezones first so the profile batch only covers users who are
        // actually due this hour.
        tzMap = await storage.getUserTimezones(pageUserIds);
        userIds = filterByLocalHour(pageUserIds, tzMap, now, opts.localHour);
        if (userIds.length === 0) return;
        profileMap = new Map(
          await Promise.all(
            userIds.map(
              async (id) => [id, await storage.getUserProfile(id)] as const,
            ),
          ),
        );
      } catch (err) {
        logger.error(
          { err },
          "notification-scheduler: failed to batch-fetch profiles for meal-log page",
        );
        return;
      }

      await runBounded(userIds, async (userId) => {
        try {
          const profile = profileMap.get(userId);
          if (isMuted(profile?.reminderMutes, "meal-log")) return;

          // Day-bucket in the user's stored timezone (NULL/invalid → "UTC").
          const tz = parseTimezone(tzMap.get(userId));

          const logs = await storage.getDailyLogs(userId, now, tz);
          if (logs.length > 0) return;

          await notify(userId, "meal-log", {
            context: { lastLoggedAt: null },
          });
        } catch (err) {
          logger.error(
            { err, userId },
            "notification-scheduler: failed meal-log reminder for user",
          );
        }
      });
    });
  } catch (err) {
    logger.error(
      { err },
      "notification-scheduler: failed to fetch user IDs for meal-log reminders",
    );
  }
}

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;
let localHourTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start the daily cron jobs that send reminders.
 * Safe to call multiple times — only one set of job instances is created.
 */
export function startNotificationScheduler(): void {
  if (scheduledTask || localHourTask) return;

  // Explicit UTC: without `timezone` node-cron matches in the host's local
  // TZ, so firing time would silently depend on the deploy box. `noOverlap`
  // skips a tick while the previous run is still in flight — the handlers
  // RETURN their promise so node-cron can see when a run finishes.
  // 09:00 UTC daily — commitment pushes
  scheduledTask = cron.schedule(
    "0 9 * * *",
    () =>
      sendDueCommitmentReminders().catch((err) => {
        logger.error(
          { err: toError(err) },
          "notification-scheduler: unhandled error in commitment cron",
        );
        reportError(err, "notification-scheduler: commitment cron");
      }),
    { timezone: "UTC", noOverlap: true, name: "commitment-reminders" },
  );

  // Hourly — per-user local-time reminders. Each run selects only the users
  // whose local hour is the target (daily check-in at 09:00 local, meal-log
  // nudge at 12:00 local), so nobody gets "nothing logged today" at 4am.
  // Re-runs are idempotent via pending_reminders_user_type_day_idx.
  localHourTask = cron.schedule(
    "0 * * * *",
    () => {
      const now = new Date();
      return Promise.all([
        sendDailyCheckinReminders({
          now,
          localHour: DAILY_CHECKIN_LOCAL_HOUR,
        }).catch((err) => {
          logger.error(
            { err: toError(err) },
            "notification-scheduler: unhandled error in daily-checkin cron",
          );
          reportError(err, "notification-scheduler: daily-checkin cron");
        }),
        sendMealLogReminders({ now, localHour: MEAL_LOG_LOCAL_HOUR }).catch(
          (err) => {
            logger.error(
              { err: toError(err) },
              "notification-scheduler: unhandled error in meal-log cron",
            );
            reportError(err, "notification-scheduler: meal-log cron");
          },
        ),
      ]);
    },
    { timezone: "UTC", noOverlap: true, name: "local-hour-reminders" },
  );

  logger.info(
    "notification-scheduler: started (09:00 UTC commitments; hourly local-time check-in 09:00 / meal-log 12:00)",
  );
}

/** Stop the scheduler (used in tests). */
export function stopNotificationScheduler(): void {
  if (scheduledTask) {
    void scheduledTask.stop();
    scheduledTask = null;
  }
  if (localHourTask) {
    void localHourTask.stop();
    localHourTask = null;
  }
}
