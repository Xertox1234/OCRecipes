import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendDueCommitmentReminders,
  sendDailyCheckinReminders,
  sendMealLogReminders,
  sendPantryExpiryNudges,
  startNotificationScheduler,
  stopNotificationScheduler,
  schedulerRunSlot,
  runWeeklyReports,
} from "../notification-scheduler";
import {
  generateWeeklyReportForUser,
  sendDueWeeklyReportPushes,
} from "../weekly-report/generate";
import { nudgeAboutExpiringPantry } from "../proactive-coach/pantry-expiry";
import { storage } from "../../storage";
import { logger } from "../../lib/logger";
import {
  createMockCoachNotebookEntry,
  createMockDailyLog,
  createMockUserProfile,
} from "../../__tests__/factories";

import { notify } from "../notifications/notify";
import cron from "node-cron";

vi.mock("../../storage", () => ({
  storage: {
    getDueCommitmentsAllUsers: vi.fn(),
    updateNotebookEntryStatus: vi.fn(),
    getUserIdPage: vi.fn(),
    getUserTimezones: vi.fn(),
    getUserProfile: vi.fn(),
    getDailyLogs: vi.fn(),
    getDailySummary: vi.fn(),
    claimSchedulerRun: vi.fn(),
    getPushTokensForUsers: vi.fn(),
  },
}));

vi.mock("../proactive-coach/pantry-expiry", () => ({
  nudgeAboutExpiringPantry: vi.fn(),
}));

vi.mock("../notifications/notify", () => ({
  notify: vi.fn(),
}));

vi.mock("../weekly-report/generate", () => ({
  generateWeeklyReportForUser: vi.fn(),
  sendDueWeeklyReportPushes: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn(), on: vi.fn() }),
  },
}));

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so leftover mockResolvedValueOnce queue
  // entries from a prior test cannot leak forward — paged loops break early
  // when a page is shorter than PAGE_SIZE, leaving the trailing []-page mock
  // unconsumed. Every test sets its own implementations, so a full reset is safe.
  vi.resetAllMocks();
  // resetAllMocks wipes the cron.schedule return value set in vi.mock above;
  // re-establish it so startNotificationScheduler() gets a stoppable task.
  // A fresh task per call, so each job's `on` listeners can be read back.
  vi.mocked(cron.schedule).mockImplementation(
    () =>
      ({
        stop: vi.fn(),
        on: vi.fn(),
      }) as unknown as ReturnType<typeof cron.schedule>,
  );
  // Default tz map is empty → every user falls back to "UTC" via parseTimezone.
  // resetAllMocks would otherwise leave getUserTimezones returning undefined,
  // which makes the scheduler's tzMap.get(...) throw. Tests that assert on a
  // specific timezone override this per-test.
  vi.mocked(storage.getUserTimezones).mockResolvedValue(new Map());
  // Default notify to pushDelivered: true. Tests that check "not delivered"
  // override this per-test.
  vi.mocked(notify).mockResolvedValue({ pushDelivered: true });
  // Default: this instance wins the run claim (single-instance behavior).
  vi.mocked(storage.claimSchedulerRun).mockResolvedValue(true);
  stopNotificationScheduler();
});

describe("sendDueCommitmentReminders", () => {
  it("does nothing when there are no due commitments", async () => {
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([]);

    await sendDueCommitmentReminders();

    expect(notify).not.toHaveBeenCalled();
    expect(storage.updateNotebookEntryStatus).not.toHaveBeenCalled();
  });

  it("pages through every due commitment, not just the oldest page (R30)", async () => {
    // A full first page of permanently-undeliverable rows must not starve
    // newer users' reminders on later pages.
    const fullPage = Array.from({ length: 500 }, (_, i) =>
      createMockCoachNotebookEntry({
        id: i + 1,
        userId: "stuck",
        type: "commitment",
        followUpDate: new Date(2020, 0, 1),
      }),
    );
    const fresh = createMockCoachNotebookEntry({
      id: 9999,
      userId: "fresh-user",
      type: "commitment",
      followUpDate: new Date(2026, 0, 1),
    });
    vi.mocked(storage.getDueCommitmentsAllUsers)
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([fresh]);
    vi.mocked(notify).mockImplementation(async (userId) => ({
      pushDelivered: userId !== "stuck",
    }));

    await sendDueCommitmentReminders();

    expect(storage.getDueCommitmentsAllUsers).toHaveBeenCalledTimes(2);
    expect(storage.getDueCommitmentsAllUsers).toHaveBeenLastCalledWith(500, {
      followUpDate: fullPage[499].followUpDate,
      id: 500,
    });
    expect(notify).toHaveBeenCalledWith(
      "fresh-user",
      "commitment",
      expect.anything(),
    );
    expect(storage.updateNotebookEntryStatus).toHaveBeenCalledWith(
      9999,
      "fresh-user",
      "completed",
      "active",
    );
  });

  it("sends a push and marks entry completed on confirmed delivery", async () => {
    const entry = createMockCoachNotebookEntry({
      id: 1,
      userId: "42",
      content: "Drink more water",
      type: "commitment",
    });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([entry]);
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    expect(notify).toHaveBeenCalledWith(
      "42",
      "commitment",
      expect.objectContaining({
        title: "Coach reminder",
        data: { entryId: 1, url: "ocrecipes://notebook-entry/1" },
      }),
    );
    expect(storage.updateNotebookEntryStatus).toHaveBeenCalledWith(
      1,
      "42",
      "completed",
      "active",
    );
  });

  it("names a commitment in the push only when it is confirmed and labelled", async () => {
    const raw = createMockCoachNotebookEntry({
      id: 3,
      userId: "42",
      type: "commitment",
      content: "The user agreed to add pumpkin seeds",
    });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([
      raw,
      {
        ...raw,
        id: 4,
        label: "pumpkin seeds on your salad",
        confirmedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    const bodies = vi
      .mocked(notify)
      .mock.calls.map((c) => (c[2] as { body?: string }).body);
    expect(bodies).toEqual([
      "Coach has a quick check-in for you.",
      "How's pumpkin seeds on your salad going?",
    ]);
  });

  it("does NOT mark entry completed when push delivery fails", async () => {
    const entry = createMockCoachNotebookEntry({ id: 2, userId: "7" });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([entry]);
    vi.mocked(notify).mockResolvedValue({ pushDelivered: false });

    await sendDueCommitmentReminders();

    expect(storage.updateNotebookEntryStatus).not.toHaveBeenCalled();
  });

  it("caps a long label in the push body", async () => {
    const entry = createMockCoachNotebookEntry({
      id: 3,
      userId: "5",
      label: "A".repeat(150),
      confirmedAt: new Date("2026-11-01T00:00:00Z"),
    });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([entry]);
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    const body = vi.mocked(notify).mock.calls[0][2]?.body;
    expect(body).toBe(`How's ${"A".repeat(80)} going?`);
  });

  it("processes multiple entries independently — failure on one does not block others", async () => {
    const entry1 = createMockCoachNotebookEntry({ id: 10, userId: "1" });
    const entry2 = createMockCoachNotebookEntry({ id: 11, userId: "2" });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([
      entry1,
      entry2,
    ]);
    vi.mocked(notify)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ pushDelivered: true });
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    // entry2 should still complete despite entry1 throwing
    expect(storage.updateNotebookEntryStatus).toHaveBeenCalledTimes(1);
    expect(storage.updateNotebookEntryStatus).toHaveBeenCalledWith(
      11,
      "2",
      "completed",
      "active",
    );
  });

  it("returns gracefully when storage fetch throws", async () => {
    vi.mocked(storage.getDueCommitmentsAllUsers).mockRejectedValue(
      new Error("db error"),
    );

    await expect(sendDueCommitmentReminders()).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it("processes a mixed batch under bounded concurrency — muted skipped, needing-reminder sent", async () => {
    const mutedEntry = createMockCoachNotebookEntry({
      id: 20,
      userId: "muted-user",
      content: "muted commitment",
      type: "commitment",
    });
    const needsEntry = createMockCoachNotebookEntry({
      id: 22,
      userId: "needs-user",
      content: "needs commitment",
      type: "commitment",
    });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([
      mutedEntry,
      needsEntry,
    ]);
    // Key profile lookup by userId — parallel execution breaks call-order mocks.
    vi.mocked(storage.getUserProfile).mockImplementation(async (userId) =>
      createMockUserProfile({
        userId,
        reminderMutes: userId === "muted-user" ? { commitment: true } : {},
      }),
    );
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    // Muted user gets no notify call.
    const notifiedUserIds = vi
      .mocked(notify)
      .mock.calls.map((c) => c[0])
      .sort();
    expect(notifiedUserIds).toEqual(["needs-user"]);
  });

  it("skips muted user — notify not called", async () => {
    const entry = createMockCoachNotebookEntry({
      id: 5,
      userId: "user-1",
      content: "Eat more vegetables",
      type: "commitment",
    });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([entry]);
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({
        userId: "user-1",
        reminderMutes: { commitment: true },
      }),
    );

    await sendDueCommitmentReminders();

    expect(notify).not.toHaveBeenCalled();
  });
});

describe("startNotificationScheduler", () => {
  it("schedules the 09:00 UTC commitment job and the hourly local-time job", () => {
    startNotificationScheduler();

    expect(cron.schedule).toHaveBeenCalledWith(
      "0 9 * * *",
      expect.any(Function),
      expect.anything(),
    );
    expect(cron.schedule).toHaveBeenCalledWith(
      "0 * * * *",
      expect.any(Function),
      expect.anything(),
    );
  });

  it("tolerates a tick a few minutes late, well inside the half-hour slot rounding", () => {
    startNotificationScheduler();

    const calls = vi.mocked(cron.schedule).mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const tolerance = call[2]?.missedExecutionTolerance;
      expect(tolerance).toBeGreaterThanOrEqual(60_000);
      // schedulerRunSlot rounds to the nearest hour: a run 30 min late would
      // claim the NEXT hour's slot.
      expect(tolerance).toBeLessThanOrEqual(10 * 60_000);
    }
  });

  it("logs an error naming the job when node-cron drops a tick", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    startNotificationScheduler();

    const results = vi.mocked(cron.schedule).mock.results;
    const names = vi.mocked(cron.schedule).mock.calls.map((c) => c[2]?.name);
    expect(names).toEqual(["commitment-reminders", "local-hour-reminders"]);
    results.forEach((result, i) => {
      const on = vi.mocked(
        (result.value as ReturnType<typeof cron.schedule>).on,
      );
      const missed = on.mock.calls.find((c) => c[0] === "execution:missed");
      expect(missed).toBeDefined();
      errorSpy.mockClear();
      (missed![1] as unknown as (ctx: { date: Date }) => void)({
        date: new Date("2026-11-15T18:00:00Z"),
      });
      expect(errorSpy).toHaveBeenCalledWith(
        { jobName: names[i], missedSlot: "2026-11-15T18:00:00.000Z" },
        expect.stringContaining("missed"),
      );
    });
    errorSpy.mockRestore();
  });

  // noOverlap drops a tick while the previous run is still going. node-cron
  // reports that as execution:overlap, not execution:missed.
  it("logs an error naming the job when a tick is dropped because the last run is still going", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    startNotificationScheduler();

    const results = vi.mocked(cron.schedule).mock.results;
    const names = vi.mocked(cron.schedule).mock.calls.map((c) => c[2]?.name);
    results.forEach((result, i) => {
      const on = vi.mocked(
        (result.value as ReturnType<typeof cron.schedule>).on,
      );
      const overlap = on.mock.calls.find((c) => c[0] === "execution:overlap");
      expect(overlap).toBeDefined();
      errorSpy.mockClear();
      (overlap![1] as unknown as (ctx: { date: Date }) => void)({
        date: new Date("2026-11-15T19:00:00Z"),
      });
      expect(errorSpy).toHaveBeenCalledWith(
        { jobName: names[i], skippedSlot: "2026-11-15T19:00:00.000Z" },
        expect.stringContaining("still running"),
      );
    });
    errorSpy.mockRestore();
  });

  it("pins every job to UTC and forbids overlapping runs (N5)", () => {
    startNotificationScheduler();

    // Without an explicit timezone node-cron matches in the host's local TZ,
    // so firing time silently depends on the deploy box. noOverlap stops a
    // slow run from being re-entered by the next tick.
    const calls = vi.mocked(cron.schedule).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[2]).toEqual(
        expect.objectContaining({
          timezone: "UTC",
          noOverlap: true,
          name: expect.any(String),
        }),
      );
    }
  });

  it("is idempotent — calling twice creates only two jobs total", () => {
    startNotificationScheduler();
    startNotificationScheduler();

    expect(cron.schedule).toHaveBeenCalledTimes(2);
  });

  it("idempotency guard also covers the hourly local-time job", () => {
    startNotificationScheduler();
    startNotificationScheduler();
    startNotificationScheduler();

    // Regardless of how many times start is called, still only two cron jobs
    expect(cron.schedule).toHaveBeenCalledTimes(2);
    expect(cron.schedule).toHaveBeenCalledWith(
      "0 * * * *",
      expect.any(Function),
      expect.anything(),
    );
  });

  it("stopNotificationScheduler allows scheduler to be restarted", () => {
    startNotificationScheduler();
    stopNotificationScheduler();
    startNotificationScheduler();

    expect(cron.schedule).toHaveBeenCalledTimes(4);
  });
});

describe("sendDailyCheckinReminders", () => {
  it("creates a daily-checkin reminder for unmuted users", async () => {
    // First page returns one user; second page returns empty to end iteration
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["user-1"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ userId: "user-1", reminderMutes: {} }),
    );
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 850,
      totalProtein: 40,
      totalCarbs: 100,
      totalFat: 30,
      itemCount: 3,
    });

    await sendDailyCheckinReminders();

    expect(notify).toHaveBeenCalledWith(
      "user-1",
      "daily-checkin",
      expect.objectContaining({
        context: { calories: 850 },
      }),
    );
  });

  it("threads the user's stored timezone into getDailySummary", async () => {
    // AC: a user with timezone "America/Los_Angeles" gets day-bucketing for
    // their local date, not UTC. Storage is mocked, so we assert the tz is
    // passed through to getDailySummary (the local-vs-UTC boundary itself is
    // covered by the getDayBounds / storage tests).
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["la-user"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserTimezones).mockResolvedValue(
      new Map([["la-user", "America/Los_Angeles"]]),
    );
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ userId: "la-user", reminderMutes: {} }),
    );
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 600,
      totalProtein: 25,
      totalCarbs: 70,
      totalFat: 20,
      itemCount: 2,
    });

    await sendDailyCheckinReminders();

    expect(storage.getUserTimezones).toHaveBeenCalledWith(["la-user"]);
    expect(storage.getDailySummary).toHaveBeenCalledWith(
      "la-user",
      expect.any(Date),
      "America/Los_Angeles",
    );
  });

  it("falls back to UTC when the stored timezone is null", async () => {
    // NULL timezone (user who never sent X-Timezone) → parseTimezone → "UTC".
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["utc-user"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserTimezones).mockResolvedValue(
      new Map([["utc-user", null]]),
    );
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ userId: "utc-user", reminderMutes: {} }),
    );
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 600,
      totalProtein: 25,
      totalCarbs: 70,
      totalFat: 20,
      itemCount: 2,
    });

    await sendDailyCheckinReminders();

    expect(storage.getDailySummary).toHaveBeenCalledWith(
      "utc-user",
      expect.any(Date),
      "UTC",
    );
  });

  it("skips users with daily-checkin muted", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["user-1"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({
        userId: "user-1",
        reminderMutes: { "daily-checkin": true },
      }),
    );

    await sendDailyCheckinReminders();

    expect(notify).not.toHaveBeenCalled();
  });

  it("returns gracefully when getUserIdPage throws", async () => {
    vi.mocked(storage.getUserIdPage).mockRejectedValue(new Error("db error"));

    await expect(sendDailyCheckinReminders()).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it("processes a mixed page under bounded concurrency — only unmuted users get notified", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["muted-user", "needs-user"])
      .mockResolvedValueOnce([]);
    // Key all per-user mocks by userId — concurrency breaks call-order mocks.
    vi.mocked(storage.getUserProfile).mockImplementation(async (userId) =>
      createMockUserProfile({
        userId,
        reminderMutes: userId === "muted-user" ? { "daily-checkin": true } : {},
      }),
    );
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 720,
      totalProtein: 30,
      totalCarbs: 80,
      totalFat: 25,
      itemCount: 2,
    });

    await sendDailyCheckinReminders();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "needs-user",
      "daily-checkin",
      expect.objectContaining({ context: { calories: 720 } }),
    );
  });

  it("isolates a per-user failure — one user throwing does not block the rest", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["bad-user", "good-user"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserProfile).mockImplementation(async (userId) =>
      createMockUserProfile({ userId, reminderMutes: {} }),
    );
    // The summary fetch (inside the per-user loop body) throws for bad-user;
    // the per-user try/catch must isolate it so good-user still gets a reminder.
    vi.mocked(storage.getDailySummary).mockImplementation(async (userId) => {
      if (userId === "bad-user") throw new Error("summary fetch failed");
      return {
        totalCalories: 500,
        totalProtein: 20,
        totalCarbs: 60,
        totalFat: 15,
        itemCount: 1,
      };
    });

    await expect(sendDailyCheckinReminders()).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "good-user",
      "daily-checkin",
      expect.objectContaining({ context: { calories: 500 } }),
    );
  });
});

describe("sendPantryExpiryNudges", () => {
  const NOW = new Date("2026-11-25T16:00:00Z");
  const token = (userId: string) =>
    ({ userId }) as Awaited<
      ReturnType<typeof storage.getPushTokensForUsers>
    >[number];

  beforeEach(() => {
    vi.mocked(nudgeAboutExpiringPantry).mockResolvedValue("sent");
    vi.mocked(storage.getUserProfile).mockImplementation(async (id) =>
      createMockUserProfile({ userId: id, reminderMutes: {} }),
    );
  });

  it("nudges only users whose local hour is the target and who have a phone to push to", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["utc-user", "tokyo-user", "no-phone"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserTimezones).mockResolvedValue(
      new Map([
        ["utc-user", "UTC"],
        ["tokyo-user", "Asia/Tokyo"], // 01:00 there
        ["no-phone", "UTC"],
      ]),
    );
    vi.mocked(storage.getPushTokensForUsers).mockResolvedValue([
      token("utc-user"),
    ]);

    await sendPantryExpiryNudges({ now: NOW, localHour: 16 });

    // Tokens are looked up only for the users due this hour.
    expect(storage.getPushTokensForUsers).toHaveBeenCalledWith([
      "utc-user",
      "no-phone",
    ]);
    expect(nudgeAboutExpiringPantry).toHaveBeenCalledTimes(1);
    expect(nudgeAboutExpiringPantry).toHaveBeenCalledWith(
      "utc-user",
      NOW,
      "UTC",
    );
  });

  it("skips a user who switched the nudge off", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["muted", "on"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getPushTokensForUsers).mockResolvedValue([
      token("muted"),
      token("on"),
    ]);
    vi.mocked(storage.getUserProfile).mockImplementation(async (id) =>
      createMockUserProfile({
        userId: id,
        reminderMutes: id === "muted" ? { "pantry-expiring": true } : {},
      }),
    );

    await sendPantryExpiryNudges({ now: NOW, localHour: 16 });

    expect(nudgeAboutExpiringPantry).toHaveBeenCalledTimes(1);
    expect(nudgeAboutExpiringPantry).toHaveBeenCalledWith("on", NOW, "UTC");
  });

  it("carries on with the next user when one fails", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["a", "b"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getPushTokensForUsers).mockResolvedValue([
      token("a"),
      token("b"),
    ]);
    vi.mocked(nudgeAboutExpiringPantry)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("sent");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    await expect(
      sendPantryExpiryNudges({ now: NOW, localHour: 16 }),
    ).resolves.toBeUndefined();

    expect(nudgeAboutExpiringPantry).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("sendMealLogReminders", () => {
  it("threads the user's stored timezone into getDailyLogs", async () => {
    // AC: the meal-log path buckets the daily-log check in the user's local
    // timezone, not UTC. Storage is mocked, so we assert the tz is passed
    // through to getDailyLogs (the local-vs-UTC boundary itself is covered by
    // the getDayBounds / storage tests).
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["la-user"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserTimezones).mockResolvedValue(
      new Map([["la-user", "America/Los_Angeles"]]),
    );
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ userId: "la-user", reminderMutes: {} }),
    );
    vi.mocked(storage.getDailyLogs).mockResolvedValue([]);

    await sendMealLogReminders();

    expect(storage.getUserTimezones).toHaveBeenCalledWith(["la-user"]);
    expect(storage.getDailyLogs).toHaveBeenCalledWith(
      "la-user",
      expect.any(Date),
      "America/Los_Angeles",
    );
  });

  it("creates a meal-log reminder when no logs exist today", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["user-1"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ userId: "user-1", reminderMutes: {} }),
    );
    vi.mocked(storage.getDailyLogs).mockResolvedValue([]);

    await sendMealLogReminders();

    expect(notify).toHaveBeenCalledWith(
      "user-1",
      "meal-log",
      expect.objectContaining({ context: { lastLoggedAt: null } }),
    );
  });

  it("skips when logs already exist today", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["user-1"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ userId: "user-1", reminderMutes: {} }),
    );
    vi.mocked(storage.getDailyLogs).mockResolvedValue([
      createMockDailyLog({ id: 1, userId: "user-1" }),
    ]);

    await sendMealLogReminders();

    expect(notify).not.toHaveBeenCalled();
  });

  it("skips when meal-log is muted", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["user-1"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({
        userId: "user-1",
        reminderMutes: { "meal-log": true },
      }),
    );
    vi.mocked(storage.getDailyLogs).mockResolvedValue([]);

    await sendMealLogReminders();

    expect(notify).not.toHaveBeenCalled();
  });

  it("returns gracefully when getUserIdPage throws", async () => {
    vi.mocked(storage.getUserIdPage).mockRejectedValue(new Error("db error"));

    await expect(sendMealLogReminders()).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it("processes a mixed page under bounded concurrency — muted and has-logs users skipped, needs-reminder gets notified", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["muted-user", "logged-user", "needs-user"])
      .mockResolvedValueOnce([]);
    // Key all per-user mocks by userId — concurrency breaks call-order mocks.
    vi.mocked(storage.getUserProfile).mockImplementation(async (userId) =>
      createMockUserProfile({
        userId,
        reminderMutes: userId === "muted-user" ? { "meal-log": true } : {},
      }),
    );
    vi.mocked(storage.getDailyLogs).mockImplementation(async (userId) =>
      userId === "logged-user" ? [createMockDailyLog({ id: 1, userId })] : [],
    );

    await sendMealLogReminders();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "needs-user",
      "meal-log",
      expect.objectContaining({ context: { lastLoggedAt: null } }),
    );
  });
});

describe("local-hour delivery (R31)", () => {
  // 2026-10-30 is PDT (UTC-7) in Los Angeles and JST (UTC+9) in Tokyo.
  function setupThreeUsers() {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["utc-user", "la-user", "tokyo-user"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserTimezones).mockResolvedValue(
      new Map<string, string | null>([
        ["utc-user", null],
        ["la-user", "America/Los_Angeles"],
        ["tokyo-user", "Asia/Tokyo"],
      ]),
    );
    vi.mocked(storage.getUserProfile).mockImplementation(async (id) =>
      createMockUserProfile({ userId: id, reminderMutes: {} }),
    );
    vi.mocked(storage.getDailyLogs).mockResolvedValue([]);
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 0,
    } as Awaited<ReturnType<typeof storage.getDailySummary>>);
  }

  function notifiedUsers(): string[] {
    return vi.mocked(notify).mock.calls.map((c) => c[0]);
  }

  it("meal-log nudge only reaches users whose local hour is 12", async () => {
    setupThreeUsers();
    // 19:00Z = 12:00 in LA, 19:00 UTC user, 04:00 next day Tokyo.
    await sendMealLogReminders({
      now: new Date("2026-10-30T19:00:00Z"),
      localHour: 12,
    });
    expect(notifiedUsers()).toEqual(["la-user"]);
  });

  it("daily check-in only reaches users whose local hour is 9", async () => {
    setupThreeUsers();
    // 00:00Z = 09:00 in Tokyo.
    await sendDailyCheckinReminders({
      now: new Date("2026-10-30T00:00:00Z"),
      localHour: 9,
    });
    expect(notifiedUsers()).toEqual(["tokyo-user"]);
  });

  it("does not fetch profiles for users outside the target hour", async () => {
    setupThreeUsers();
    await sendMealLogReminders({
      now: new Date("2026-10-30T12:00:00Z"),
      localHour: 12,
    });
    expect(notifiedUsers()).toEqual(["utc-user"]);
    expect(storage.getUserProfile).toHaveBeenCalledTimes(1);
    expect(storage.getUserProfile).toHaveBeenCalledWith("utc-user");
  });

  it("the scheduler runs the local-hour reminders hourly in UTC", async () => {
    startNotificationScheduler();
    const hourly = vi
      .mocked(cron.schedule)
      .mock.calls.find((c) => c[0] === "0 * * * *");
    expect(hourly).toBeDefined();
    expect(hourly![2]).toEqual(
      expect.objectContaining({ timezone: "UTC", noOverlap: true }),
    );
  });
});

describe("multi-instance run claim", () => {
  function handlerFor(expr: string) {
    startNotificationScheduler();
    const call = vi.mocked(cron.schedule).mock.calls.find((c) => c[0] === expr);
    expect(call).toBeDefined();
    return call![1] as unknown as () => Promise<unknown>;
  }

  it("rounds to the nearest UTC hour so clock skew cannot split a slot", () => {
    expect(schedulerRunSlot(new Date("2026-11-01T08:59:59.900Z"))).toBe(
      "2026-11-01T09",
    );
    expect(schedulerRunSlot(new Date("2026-11-01T09:00:00.100Z"))).toBe(
      "2026-11-01T09",
    );
    expect(schedulerRunSlot(new Date("2026-11-01T23:59:59.900Z"))).toBe(
      "2026-11-02T00",
    );
  });

  it("commitment job sends when it wins the claim, under its own job name", async () => {
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([]);
    await handlerFor("0 9 * * *")();

    expect(storage.claimSchedulerRun).toHaveBeenCalledWith(
      "commitment-reminders",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}$/),
    );
    expect(storage.getDueCommitmentsAllUsers).toHaveBeenCalled();
  });

  it("commitment job does nothing when another instance holds the claim", async () => {
    vi.mocked(storage.claimSchedulerRun).mockResolvedValue(false);
    await handlerFor("0 9 * * *")();

    expect(storage.getDueCommitmentsAllUsers).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("local-hour job does nothing when another instance holds the claim", async () => {
    vi.mocked(storage.claimSchedulerRun).mockResolvedValue(false);
    await handlerFor("0 * * * *")();

    expect(storage.claimSchedulerRun).toHaveBeenCalledWith(
      "local-hour-reminders",
      expect.any(String),
    );
    expect(storage.getUserIdPage).not.toHaveBeenCalled();
  });

  it("local-hour job runs when it wins the claim", async () => {
    vi.mocked(storage.getUserIdPage).mockResolvedValue([]);
    await handlerFor("0 * * * *")();

    expect(storage.getUserIdPage).toHaveBeenCalled();
  });

  it("skips the run (fails closed) when the claim itself errors", async () => {
    vi.mocked(storage.claimSchedulerRun).mockRejectedValue(
      new Error("db down"),
    );
    await expect(handlerFor("0 9 * * *")()).resolves.toBeUndefined();

    expect(storage.getDueCommitmentsAllUsers).not.toHaveBeenCalled();
  });
});

describe("weekly report schedule", () => {
  function setupUsers() {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["la-user", "tokyo-user", "utc-user"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserTimezones).mockResolvedValue(
      new Map<string, string | null>([
        ["la-user", "America/Los_Angeles"],
        ["tokyo-user", "Asia/Tokyo"],
        ["utc-user", null],
      ]),
    );
    vi.mocked(generateWeeklyReportForUser).mockResolvedValue("created");
    vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);
  }

  it("writes reports only for users at local Sunday 18:00, then sends due pushes", async () => {
    setupUsers();
    // 2026-11-16T02:00Z = Sun 18:00 in LA; Mon 11:00 in Tokyo; Mon 02:00 UTC.
    const now = new Date("2026-11-16T02:00:00Z");
    await runWeeklyReports(now);
    expect(vi.mocked(generateWeeklyReportForUser).mock.calls).toEqual([
      ["la-user", now, "America/Los_Angeles"],
    ]);
    expect(sendDueWeeklyReportPushes).toHaveBeenCalledWith(now);
  });

  // M-rel-1: a missed 18:00 tick (restart, DB blip) is caught up later the
  // same evening; generation skips a week that already has a report.
  it("catches up a user later on Sunday evening, before 22:00", async () => {
    setupUsers();
    // 2026-11-16T05:00Z = Sun 21:00 in LA; Mon 14:00 in Tokyo; Mon 05:00 UTC.
    const now = new Date("2026-11-16T05:00:00Z");
    await runWeeklyReports(now);
    expect(vi.mocked(generateWeeklyReportForUser).mock.calls).toEqual([
      ["la-user", now, "America/Los_Angeles"],
    ]);
  });

  it("does not run at Sunday 22:00", async () => {
    setupUsers();
    const now = new Date("2026-11-16T06:00:00Z"); // Sun 22:00 in LA
    await runWeeklyReports(now);
    expect(generateWeeklyReportForUser).not.toHaveBeenCalled();
  });

  it("still sends due pushes in an hour when nobody is at Sunday 18:00", async () => {
    setupUsers();
    const now = new Date("2026-11-17T17:00:00Z"); // Tuesday everywhere
    await runWeeklyReports(now);
    expect(generateWeeklyReportForUser).not.toHaveBeenCalled();
    expect(sendDueWeeklyReportPushes).toHaveBeenCalledWith(now);
  });

  it("one user's failure does not stop the others or the pushes", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["a", "b"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserTimezones).mockResolvedValue(new Map());
    vi.mocked(generateWeeklyReportForUser)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("created");
    vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);
    const now = new Date("2026-11-15T18:00:00Z"); // Sun 18:00 UTC
    await runWeeklyReports(now);
    expect(generateWeeklyReportForUser).toHaveBeenCalledTimes(2);
    expect(sendDueWeeklyReportPushes).toHaveBeenCalled();
  });

  it("the hourly local-hour job runs the weekly report too", async () => {
    setupUsers();
    vi.mocked(storage.getUserIdPage).mockResolvedValue([]);
    startNotificationScheduler();
    const call = vi
      .mocked(cron.schedule)
      .mock.calls.find((c) => c[0] === "0 * * * *");
    await (call![1] as unknown as () => Promise<unknown>)();
    expect(sendDueWeeklyReportPushes).toHaveBeenCalled();
  });

  describe("run summary", () => {
    const SUMMARY = "notification-scheduler: weekly report run";
    const ALL_FAILED =
      "notification-scheduler: weekly report failed for every user it tried";
    const now = new Date("2026-11-15T18:00:00Z"); // Sun 18:00 UTC

    function spies() {
      return {
        info: vi.spyOn(logger, "info").mockImplementation(() => {}),
        error: vi.spyOn(logger, "error").mockImplementation(() => {}),
      };
    }
    const withMessage = (
      spy: { mock: { calls: unknown[][] } },
      message: string,
    ) => spy.mock.calls.filter((c) => c[1] === message);

    it("logs one line of counts per tick, across pages", async () => {
      const { info, error } = spies();
      const firstPage = Array.from({ length: 500 }, (_, i) => `u${i}`);
      vi.mocked(storage.getUserIdPage)
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(["pro", "has-one", "free", "off", "broken"])
        .mockResolvedValueOnce([]);
      vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);
      const outcome: Record<string, string> = {
        "has-one": "exists",
        free: "skipped-not-pro",
        off: "skipped-disabled",
      };
      vi.mocked(generateWeeklyReportForUser).mockImplementation(
        async (userId) => {
          if (userId === "broken") throw new Error("boom");
          return (outcome[userId] ?? "created") as Awaited<
            ReturnType<typeof generateWeeklyReportForUser>
          >;
        },
      );

      await runWeeklyReports(now);

      expect(withMessage(info, SUMMARY)).toEqual([
        [
          {
            inWindow: 505,
            created: 501,
            exists: 1,
            skippedNotPro: 1,
            skippedDisabled: 1,
            failed: 1,
            aiCallFailed: 0,
            badReply: 0,
          },
          SUMMARY,
        ],
      ]);
      expect(withMessage(error, ALL_FAILED)).toEqual([]);
      info.mockRestore();
      error.mockRestore();
    });

    it("logs an error when every user it tried failed", async () => {
      const { info, error } = spies();
      vi.mocked(storage.getUserIdPage)
        .mockResolvedValueOnce(["a", "b", "free"])
        .mockResolvedValueOnce([]);
      vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);
      vi.mocked(generateWeeklyReportForUser).mockImplementation(
        async (userId) => {
          if (userId === "free") return "skipped-not-pro";
          throw new Error("boom");
        },
      );

      await runWeeklyReports(now);

      expect(withMessage(info, SUMMARY)).toHaveLength(1);
      expect(withMessage(error, ALL_FAILED)).toEqual([
        [{ inWindow: 3, tried: 2, failed: 2 }, ALL_FAILED],
      ]);
      info.mockRestore();
      error.mockRestore();
    });

    // In a catch-up hour everyone else already has the report, so the users
    // "tried" shrink to the one whose row is bad. That is one user's problem,
    // already logged per user, not a systemic failure.
    it("does not raise the all-failed alarm for a single failing user in a catch-up hour", async () => {
      const { info, error } = spies();
      vi.mocked(storage.getUserIdPage)
        .mockResolvedValueOnce(["has-one", "also-has-one", "broken"])
        .mockResolvedValueOnce([]);
      vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);
      vi.mocked(generateWeeklyReportForUser).mockImplementation(
        async (userId) => {
          if (userId === "broken") throw new Error("boom");
          return "exists";
        },
      );

      await runWeeklyReports(now);

      expect(withMessage(info, SUMMARY)).toHaveLength(1);
      expect(withMessage(error, ALL_FAILED)).toEqual([]);
      info.mockRestore();
      error.mockRestore();
    });

    const AI_FAILED =
      "notification-scheduler: weekly report AI call failed, template text used";

    // The template fallback counts as created, so an outage never trips the
    // all-failed alarm. It raises ONE error for the run, not one per user.
    it("a provider outage raises one error for the run and counts the fallbacks", async () => {
      const { info, error } = spies();
      vi.mocked(storage.getUserIdPage)
        .mockResolvedValueOnce(["a", "b", "c", "fine"])
        .mockResolvedValueOnce([]);
      vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);
      vi.mocked(generateWeeklyReportForUser).mockImplementation(
        async (userId) =>
          userId === "fine" ? "created" : "created-ai-call-failed",
      );

      await runWeeklyReports(now);

      expect(withMessage(info, SUMMARY)).toEqual([
        [
          {
            inWindow: 4,
            created: 4,
            exists: 0,
            skippedNotPro: 0,
            skippedDisabled: 0,
            failed: 0,
            aiCallFailed: 3,
            badReply: 0,
          },
          SUMMARY,
        ],
      ]);
      expect(withMessage(error, AI_FAILED)).toEqual([
        [{ created: 4, aiCallFailed: 3 }, AI_FAILED],
      ]);
      expect(withMessage(error, ALL_FAILED)).toEqual([]);
      info.mockRestore();
      error.mockRestore();
    });

    // Owner ruling 2026-11-23: an unusable reply is counted, never an error.
    it("counts an unusable AI reply without raising an error", async () => {
      const { info, error } = spies();
      vi.mocked(storage.getUserIdPage)
        .mockResolvedValueOnce(["a", "b"])
        .mockResolvedValueOnce([]);
      vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);
      vi.mocked(generateWeeklyReportForUser).mockResolvedValue(
        "created-bad-reply",
      );

      await runWeeklyReports(now);

      expect(withMessage(info, SUMMARY)[0][0]).toMatchObject({
        created: 2,
        aiCallFailed: 0,
        badReply: 2,
      });
      expect(error).not.toHaveBeenCalled();
      info.mockRestore();
      error.mockRestore();
    });

    it("stays quiet in a catch-up hour where everyone already has the report", async () => {
      const { info, error } = spies();
      vi.mocked(storage.getUserIdPage)
        .mockResolvedValueOnce(["a", "b"])
        .mockResolvedValueOnce([]);
      vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);
      vi.mocked(generateWeeklyReportForUser).mockResolvedValue("exists");

      await runWeeklyReports(now);

      expect(withMessage(info, SUMMARY)).toEqual([]);
      expect(withMessage(error, ALL_FAILED)).toEqual([]);
      info.mockRestore();
      error.mockRestore();
    });

    // Plan and setting are checked before "already has one", so a free or
    // report-off user comes back skipped on every tick of the window.
    it("stays quiet in a catch-up hour when the rest are skipped for their plan or setting", async () => {
      const { info, error } = spies();
      vi.mocked(storage.getUserIdPage)
        .mockResolvedValueOnce(["has-one", "free", "off"])
        .mockResolvedValueOnce([]);
      vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);
      const outcome: Record<string, string> = {
        "has-one": "exists",
        free: "skipped-not-pro",
        off: "skipped-disabled",
      };
      vi.mocked(generateWeeklyReportForUser).mockImplementation(
        async (userId) =>
          outcome[userId] as Awaited<
            ReturnType<typeof generateWeeklyReportForUser>
          >,
      );

      await runWeeklyReports(now);

      expect(withMessage(info, SUMMARY)).toEqual([]);
      expect(withMessage(error, ALL_FAILED)).toEqual([]);
      info.mockRestore();
      error.mockRestore();
    });

    it("logs nothing on a tick with nobody in the report window", async () => {
      const { info, error } = spies();
      vi.mocked(storage.getUserIdPage)
        .mockResolvedValueOnce(["a", "b"])
        .mockResolvedValueOnce([]);
      vi.mocked(sendDueWeeklyReportPushes).mockResolvedValue(0);

      await runWeeklyReports(new Date("2026-11-18T12:00:00Z")); // Wednesday

      expect(generateWeeklyReportForUser).not.toHaveBeenCalled();
      expect(withMessage(info, SUMMARY)).toEqual([]);
      info.mockRestore();
      error.mockRestore();
    });
  });
});
