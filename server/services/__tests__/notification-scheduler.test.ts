import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendDueCommitmentReminders,
  startNotificationScheduler,
  stopNotificationScheduler,
} from "../notification-scheduler";
import { storage } from "../../storage";
import { createMockCoachNotebookEntry } from "../../__tests__/factories";

import { sendPushToUser } from "../push-notifications";
import cron from "node-cron";

vi.mock("../../storage", () => ({
  storage: {
    getDueCommitmentsAllUsers: vi.fn(),
    updateNotebookEntryStatus: vi.fn(),
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
});

describe("startNotificationScheduler", () => {
  it("schedules a daily 09:00 cron job", () => {
    startNotificationScheduler();

    expect(cron.schedule).toHaveBeenCalledWith(
      "0 9 * * *",
      expect.any(Function),
    );
  });

  it("is idempotent — calling twice creates only one job", () => {
    startNotificationScheduler();
    startNotificationScheduler();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });

  it("stopNotificationScheduler allows scheduler to be restarted", () => {
    startNotificationScheduler();
    stopNotificationScheduler();
    startNotificationScheduler();

    expect(cron.schedule).toHaveBeenCalledTimes(2);
  });
});
