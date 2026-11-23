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
import {
  generateWeeklyReportForUser,
  sendDueWeeklyReportPushes,
} from "./weekly-report/generate";
import { reportWeekFor } from "./weekly-report/week-window";
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
        // Certainty rule (visible memory, 2026-11-08): name the commitment
        // only when the user confirmed it and it has a label in their words.
        body:
          entry.confirmedAt && entry.label
            ? `How's ${entry.label.slice(0, 80)} going?`
            : "Coach has a quick check-in for you.",
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

/**
 * Coach weekly report, run every hour: write the report for each user whose
 * local time is Sunday 18:00–21:59 (the later ticks catch up a missed one —
 * see WEEKLY_REPORT_CATCH_UP_HOURS), then send every push that is due (including
 * ones held overnight). Generation is idempotent per (user, week) and pushes
 * are claimed before sending, so a re-run sends nothing twice.
 */
export async function runWeeklyReports(now: Date): Promise<void> {
  // Counts only — one summary line per tick, never report or health data.
  const counts = {
    inWindow: 0,
    created: 0,
    exists: 0,
    skippedNotPro: 0,
    skippedDisabled: 0,
    failed: 0,
  };
  try {
    await forEachUserPaged(async (pageUserIds) => {
      let tzMap: Map<string, string | null>;
      try {
        tzMap = await storage.getUserTimezones(pageUserIds);
      } catch (err) {
        logger.error(
          { err: toError(err) },
          "notification-scheduler: failed to fetch timezones for weekly report page",
        );
        return;
      }
      const due = pageUserIds.filter(
        (id) => reportWeekFor(now, parseTimezone(tzMap.get(id))).isReportDue,
      );
      counts.inWindow += due.length;
      await runBounded(due, async (userId) => {
        try {
          const result = await generateWeeklyReportForUser(
            userId,
            now,
            parseTimezone(tzMap.get(userId)),
          );
          if (result === "created") counts.created++;
          else if (result === "exists") counts.exists++;
          else if (result === "skipped-not-pro") counts.skippedNotPro++;
          else counts.skippedDisabled++;
        } catch (err) {
          counts.failed++;
          logger.error(
            { err: toError(err), userId },
            "notification-scheduler: failed weekly report for user",
          );
        }
      });
    });
  } catch (err) {
    logger.error(
      { err },
      "notification-scheduler: failed to page users for weekly report",
    );
  }
  // A tick that wrote nothing and failed nothing says nothing: a catch-up
  // hour where everyone already has the report or is skipped for their plan
  // or setting (those are checked before "already has one", so they recur on
  // every tick of the window).
  if (counts.created + counts.failed > 0) {
    logger.info(counts, "notification-scheduler: weekly report run");
    // Users skipped for their plan or setting, or already done, were not tried.
    const tried =
      counts.inWindow -
      counts.exists -
      counts.skippedNotPro -
      counts.skippedDisabled;
    if (counts.failed > 0 && counts.failed === tried) {
      logger.error(
        { inWindow: counts.inWindow, tried, failed: counts.failed },
        "notification-scheduler: weekly report failed for every user it tried",
      );
    }
  }
  try {
    await sendDueWeeklyReportPushes(now);
  } catch (err) {
    logger.error(
      { err },
      "notification-scheduler: failed sending weekly report pushes",
    );
  }
}

/**
 * Run slot for a cron tick: the nearest UTC hour boundary, e.g. "2026-11-01T09".
 * Both jobs fire on the hour. node-cron itself never fires early, only on time
 * or late (up to MISSED_EXECUTION_TOLERANCE_MS), but instances' clocks differ:
 * one whose clock runs slightly behind reads 08:59:59.9 at its own tick.
 * Rounding gives both instances the SAME slot — truncating would split them
 * across two slots and both would run. A run more than 30 minutes late would
 * round to the next hour, so the tolerance must stay well under that.
 * Exported for testing.
 */
export function schedulerRunSlot(now: Date): string {
  const HOUR_MS = 3_600_000;
  return new Date(Math.round(now.getTime() / HOUR_MS) * HOUR_MS)
    .toISOString()
    .slice(0, 13);
}

/**
 * Run `job` only if this instance wins the durable (jobName, slot) claim, so a
 * tick that fires on several server instances sends once. `now` is taken once
 * and handed to the job. A failed claim (DB unreachable) skips the run — failing
 * open would reintroduce the double send, and the senders need the DB anyway.
 * The claim is consumed even if the run then crashes; commitments stay "active"
 * and are picked up by the next day's run.
 */
async function runIfClaimed(
  jobName: string,
  job: (now: Date) => Promise<unknown>,
): Promise<void> {
  const now = new Date();
  let claimed: boolean;
  try {
    claimed = await storage.claimSchedulerRun(jobName, schedulerRunSlot(now));
  } catch (err) {
    logger.error(
      { err: toError(err), jobName },
      "notification-scheduler: failed to claim run, skipping",
    );
    reportError(err, `notification-scheduler: claim ${jobName}`);
    return;
  }
  if (!claimed) {
    logger.info(
      { jobName },
      "notification-scheduler: run already claimed by another instance, skipping",
    );
    return;
  }
  await job(now);
}

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;
let localHourTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * How late a tick may wake and still run. node-cron's default is 1 second:
 * past it the tick is dropped, with no catch-up. Five minutes covers a busy
 * event loop or a slow start, keeps the run inside the same local hour for
 * every user, and stays far below the 30 minutes at which schedulerRunSlot
 * would round a late run into the next hour's slot.
 */
const MISSED_EXECUTION_TOLERANCE_MS = 5 * 60_000;

/**
 * node-cron drops a tick in two ways, and neither is retried: make both loud.
 * `execution:missed` is a tick later than the tolerance; `execution:overlap`
 * is a tick `noOverlap` blocked because the previous run was still going.
 */
function logMissedExecutions(
  task: ReturnType<typeof cron.schedule>,
  jobName: string,
): void {
  task.on("execution:missed", (ctx) => {
    logger.error(
      { jobName, missedSlot: ctx.date.toISOString() },
      "notification-scheduler: missed a scheduled run",
    );
  });
  task.on("execution:overlap", (ctx) => {
    logger.error(
      { jobName, skippedSlot: ctx.date.toISOString() },
      "notification-scheduler: skipped a scheduled run, the previous one was still running",
    );
  });
}

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
      runIfClaimed("commitment-reminders", () =>
        sendDueCommitmentReminders(),
      ).catch((err) => {
        logger.error(
          { err: toError(err) },
          "notification-scheduler: unhandled error in commitment cron",
        );
        reportError(err, "notification-scheduler: commitment cron");
      }),
    {
      timezone: "UTC",
      noOverlap: true,
      name: "commitment-reminders",
      missedExecutionTolerance: MISSED_EXECUTION_TOLERANCE_MS,
    },
  );
  logMissedExecutions(scheduledTask, "commitment-reminders");

  // Hourly — per-user local-time reminders. Each run selects only the users
  // whose local hour is the target (daily check-in at 09:00 local, meal-log
  // nudge at 12:00 local), so nobody gets "nothing logged today" at 4am.
  // Re-runs are idempotent via pending_reminders_user_type_day_idx.
  localHourTask = cron.schedule(
    "0 * * * *",
    () =>
      runIfClaimed("local-hour-reminders", (now) =>
        Promise.all([
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
          runWeeklyReports(now).catch((err) => {
            logger.error(
              { err: toError(err) },
              "notification-scheduler: unhandled error in weekly-report cron",
            );
            reportError(err, "notification-scheduler: weekly-report cron");
          }),
        ]),
      ),
    {
      timezone: "UTC",
      noOverlap: true,
      name: "local-hour-reminders",
      missedExecutionTolerance: MISSED_EXECUTION_TOLERANCE_MS,
    },
  );
  logMissedExecutions(localHourTask, "local-hour-reminders");

  logger.info(
    "notification-scheduler: started (09:00 UTC commitments; hourly local-time check-in 09:00 / meal-log 12:00 / weekly report Sun 18:00)",
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
