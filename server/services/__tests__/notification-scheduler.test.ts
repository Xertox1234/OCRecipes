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
  vi.clearAllMocks();
  stopNotificationScheduler();
});

describe("sendDueCommitmentReminders", () => {
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
});

describe("sendMealLogReminders", () => {
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
});
