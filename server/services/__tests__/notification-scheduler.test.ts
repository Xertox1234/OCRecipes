import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendDueCommitmentReminders,
  sendDailyCheckinReminders,
  sendMealLogReminders,
  startNotificationScheduler,
  stopNotificationScheduler,
} from "../notification-scheduler";
import { storage } from "../../storage";
import {
  createMockCoachNotebookEntry,
  createMockDailyLog,
  createMockUserProfile,
} from "../../__tests__/factories";

import { sendPushToUser } from "../push-notifications";
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
    hasPendingReminderToday: vi.fn(),
    createPendingReminder: vi.fn(),
  },
}));

vi.mock("../push-notifications", () => ({
  sendPushToUser: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
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
  vi.mocked(cron.schedule).mockReturnValue({
    stop: vi.fn(),
  } as unknown as ReturnType<typeof cron.schedule>);
  // Default tz map is empty → every user falls back to "UTC" via parseTimezone.
  // resetAllMocks would otherwise leave getUserTimezones returning undefined,
  // which makes the scheduler's tzMap.get(...) throw. Tests that assert on a
  // specific timezone override this per-test.
  vi.mocked(storage.getUserTimezones).mockResolvedValue(new Map());
  stopNotificationScheduler();
});

describe("sendDueCommitmentReminders", () => {
  it("threads the user's stored timezone into hasPendingReminderToday", async () => {
    // AC: the commitment path buckets the dedup window in the user's local
    // timezone, not UTC. Storage is mocked, so we assert the tz is passed
    // through (the local-vs-UTC boundary itself is covered by the storage
    // getDayBounds / hasPendingReminderToday tests).
    const entry = createMockCoachNotebookEntry({
      id: 10,
      userId: "la-user",
      content: "Stretch daily",
      type: "commitment",
    });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([entry]);
    vi.mocked(storage.getUserTimezones).mockResolvedValue(
      new Map([["la-user", "America/Los_Angeles"]]),
    );
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);
    vi.mocked(sendPushToUser).mockResolvedValue(true);
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    expect(storage.getUserTimezones).toHaveBeenCalledWith(["la-user"]);
    expect(storage.hasPendingReminderToday).toHaveBeenCalledWith(
      "la-user",
      "commitment",
      "America/Los_Angeles",
    );
  });

  it("does nothing when there are no due commitments", async () => {
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([]);

    await sendDueCommitmentReminders();

    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(storage.updateNotebookEntryStatus).not.toHaveBeenCalled();
  });

  it("sends a push and marks entry completed on confirmed delivery", async () => {
    const entry = createMockCoachNotebookEntry({
      id: 1,
      userId: "42",
      content: "Drink more water",
      type: "commitment",
    });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([entry]);
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);
    vi.mocked(sendPushToUser).mockResolvedValue(true);
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    expect(sendPushToUser).toHaveBeenCalledWith(
      "42",
      "Coach reminder",
      "Drink more water",
      { entryId: 1 },
    );
    expect(storage.updateNotebookEntryStatus).toHaveBeenCalledWith(
      1,
      "42",
      "completed",
    );
  });

  it("does NOT mark entry completed when push delivery fails", async () => {
    const entry = createMockCoachNotebookEntry({ id: 2, userId: "7" });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([entry]);
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);
    vi.mocked(sendPushToUser).mockResolvedValue(false);

    await sendDueCommitmentReminders();

    expect(storage.updateNotebookEntryStatus).not.toHaveBeenCalled();
  });

  it("truncates long content to 100 chars in the push body", async () => {
    const longContent = "A".repeat(150);
    const entry = createMockCoachNotebookEntry({
      id: 3,
      userId: "5",
      content: longContent,
    });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([entry]);
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);
    vi.mocked(sendPushToUser).mockResolvedValue(true);
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    const body = vi.mocked(sendPushToUser).mock.calls[0][2];
    expect(body.length).toBe(100);
  });

  it("processes multiple entries independently — failure on one does not block others", async () => {
    const entry1 = createMockCoachNotebookEntry({ id: 10, userId: "1" });
    const entry2 = createMockCoachNotebookEntry({ id: 11, userId: "2" });
    vi.mocked(storage.getDueCommitmentsAllUsers).mockResolvedValue([
      entry1,
      entry2,
    ]);
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);
    vi.mocked(sendPushToUser)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(true);
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    // entry2 should still complete despite entry1 throwing
    expect(storage.updateNotebookEntryStatus).toHaveBeenCalledTimes(1);
    expect(storage.updateNotebookEntryStatus).toHaveBeenCalledWith(
      11,
      "2",
      "completed",
    );
  });

  it("returns gracefully when storage fetch throws", async () => {
    vi.mocked(storage.getDueCommitmentsAllUsers).mockRejectedValue(
      new Error("db error"),
    );

    await expect(sendDueCommitmentReminders()).resolves.toBeUndefined();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("processes a mixed batch under bounded concurrency — muted skipped, already-pending skipped, needing-reminder sent", async () => {
    const mutedEntry = createMockCoachNotebookEntry({
      id: 20,
      userId: "muted-user",
      content: "muted commitment",
      type: "commitment",
    });
    const pendingEntry = createMockCoachNotebookEntry({
      id: 21,
      userId: "pending-user",
      content: "pending commitment",
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
      pendingEntry,
      needsEntry,
    ]);
    // Key profile lookup by userId — parallel execution breaks call-order mocks.
    vi.mocked(storage.getUserProfile).mockImplementation(async (userId) =>
      createMockUserProfile({
        userId,
        reminderMutes: userId === "muted-user" ? { commitment: true } : {},
      }),
    );
    vi.mocked(storage.hasPendingReminderToday).mockImplementation(
      async (userId) => userId === "pending-user",
    );
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);
    vi.mocked(sendPushToUser).mockResolvedValue(true);
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    // Only the needs-user gets a fresh pending reminder created.
    expect(storage.createPendingReminder).toHaveBeenCalledTimes(1);
    expect(storage.createPendingReminder).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "needs-user", type: "commitment" }),
    );
    // Muted user gets no push; pending + needs users do.
    const pushedUserIds = vi
      .mocked(sendPushToUser)
      .mock.calls.map((c) => c[0])
      .sort();
    expect(pushedUserIds).toEqual(["needs-user", "pending-user"]);
  });

  it("skips creating pending reminder when commitment is muted", async () => {
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
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(sendPushToUser).mockResolvedValue(true);
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

    await sendDueCommitmentReminders();

    expect(storage.createPendingReminder).not.toHaveBeenCalled();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });
});

describe("startNotificationScheduler", () => {
  it("schedules daily cron jobs at 09:00 and 12:00", () => {
    startNotificationScheduler();

    expect(cron.schedule).toHaveBeenCalledWith(
      "0 9 * * *",
      expect.any(Function),
    );
    expect(cron.schedule).toHaveBeenCalledWith(
      "0 12 * * *",
      expect.any(Function),
    );
  });

  it("is idempotent — calling twice creates only two jobs total", () => {
    startNotificationScheduler();
    startNotificationScheduler();

    expect(cron.schedule).toHaveBeenCalledTimes(2);
  });

  it("idempotency guard also covers the 12:00 meal-log job", () => {
    startNotificationScheduler();
    startNotificationScheduler();
    startNotificationScheduler();

    // Regardless of how many times start is called, still only two cron jobs
    expect(cron.schedule).toHaveBeenCalledTimes(2);
    expect(cron.schedule).toHaveBeenCalledWith(
      "0 12 * * *",
      expect.any(Function),
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
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

    await sendDailyCheckinReminders();

    expect(storage.createPendingReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "daily-checkin",
        context: { calories: 850 },
      }),
    );
  });

  it("threads the user's stored timezone into hasPendingReminderToday", async () => {
    // AC: a user with timezone "America/Los_Angeles" gets day-bucketing for
    // their local date, not UTC. Storage is mocked, so we assert the tz is
    // passed through (the local-vs-UTC boundary itself is covered by the
    // getDayBounds / hasPendingReminderToday storage tests).
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
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

    await sendDailyCheckinReminders();

    expect(storage.getUserTimezones).toHaveBeenCalledWith(["la-user"]);
    expect(storage.hasPendingReminderToday).toHaveBeenCalledWith(
      "la-user",
      "daily-checkin",
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
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

    await sendDailyCheckinReminders();

    expect(storage.hasPendingReminderToday).toHaveBeenCalledWith(
      "utc-user",
      "daily-checkin",
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
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);

    await sendDailyCheckinReminders();

    expect(storage.createPendingReminder).not.toHaveBeenCalled();
  });

  it("skips if daily-checkin reminder already exists today", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["user-1"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ userId: "user-1", reminderMutes: {} }),
    );
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(true);

    await sendDailyCheckinReminders();

    expect(storage.createPendingReminder).not.toHaveBeenCalled();
  });

  it("returns gracefully when getUserIdPage throws", async () => {
    vi.mocked(storage.getUserIdPage).mockRejectedValue(new Error("db error"));

    await expect(sendDailyCheckinReminders()).resolves.toBeUndefined();
    expect(storage.createPendingReminder).not.toHaveBeenCalled();
  });

  it("processes a mixed page under bounded concurrency — only the needing-reminder user gets one", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["muted-user", "pending-user", "needs-user"])
      .mockResolvedValueOnce([]);
    // Key all per-user mocks by userId — concurrency breaks call-order mocks.
    vi.mocked(storage.getUserProfile).mockImplementation(async (userId) =>
      createMockUserProfile({
        userId,
        reminderMutes: userId === "muted-user" ? { "daily-checkin": true } : {},
      }),
    );
    vi.mocked(storage.hasPendingReminderToday).mockImplementation(
      async (userId) => userId === "pending-user",
    );
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 720,
      totalProtein: 30,
      totalCarbs: 80,
      totalFat: 25,
      itemCount: 2,
    });
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

    await sendDailyCheckinReminders();

    expect(storage.createPendingReminder).toHaveBeenCalledTimes(1);
    expect(storage.createPendingReminder).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "needs-user", type: "daily-checkin" }),
    );
  });

  it("isolates a per-user failure — one user throwing does not block the rest", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce(["bad-user", "good-user"])
      .mockResolvedValueOnce([]);
    vi.mocked(storage.getUserProfile).mockImplementation(async (userId) =>
      createMockUserProfile({ userId, reminderMutes: {} }),
    );
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
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
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

    await expect(sendDailyCheckinReminders()).resolves.toBeUndefined();

    expect(storage.createPendingReminder).toHaveBeenCalledTimes(1);
    expect(storage.createPendingReminder).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "good-user", type: "daily-checkin" }),
    );
  });
});

describe("sendMealLogReminders", () => {
  it("threads the user's stored timezone into hasPendingReminderToday", async () => {
    // AC: the meal-log path buckets the dedup window in the user's local
    // timezone, not UTC. Storage is mocked, so we assert the tz is passed
    // through (the local-vs-UTC boundary itself is covered by the storage
    // getDayBounds / hasPendingReminderToday tests).
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
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

    await sendMealLogReminders();

    expect(storage.getUserTimezones).toHaveBeenCalledWith(["la-user"]);
    expect(storage.hasPendingReminderToday).toHaveBeenCalledWith(
      "la-user",
      "meal-log",
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
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

    await sendMealLogReminders();

    expect(storage.createPendingReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "meal-log",
      }),
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
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);

    await sendMealLogReminders();

    expect(storage.createPendingReminder).not.toHaveBeenCalled();
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
    vi.mocked(storage.hasPendingReminderToday).mockResolvedValue(false);

    await sendMealLogReminders();

    expect(storage.createPendingReminder).not.toHaveBeenCalled();
  });

  it("returns gracefully when getUserIdPage throws", async () => {
    vi.mocked(storage.getUserIdPage).mockRejectedValue(new Error("db error"));

    await expect(sendMealLogReminders()).resolves.toBeUndefined();
    expect(storage.createPendingReminder).not.toHaveBeenCalled();
  });

  it("processes a mixed page under bounded concurrency — muted, has-logs, and already-pending users skipped", async () => {
    vi.mocked(storage.getUserIdPage)
      .mockResolvedValueOnce([
        "muted-user",
        "logged-user",
        "pending-user",
        "needs-user",
      ])
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
    vi.mocked(storage.hasPendingReminderToday).mockImplementation(
      async (userId) => userId === "pending-user",
    );
    vi.mocked(storage.createPendingReminder).mockResolvedValue(undefined);

    await sendMealLogReminders();

    expect(storage.createPendingReminder).toHaveBeenCalledTimes(1);
    expect(storage.createPendingReminder).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "needs-user", type: "meal-log" }),
    );
  });
});
