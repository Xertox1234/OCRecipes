import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../../storage";
import { sendPushToUser } from "../../push-notifications";
import { notify } from "../notify";

vi.mock("../../../storage", () => ({
  storage: {
    createPendingReminder: vi.fn(),
    recordNotificationSend: vi.fn(),
  },
}));
vi.mock("../../push-notifications", () => ({
  sendPushToUser: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("notify()", () => {
  it("commitment → in-app reminder + push, no ledger (not capped); returns delivery", async () => {
    vi.mocked(sendPushToUser).mockResolvedValue(true);
    const when = new Date("2026-06-25T09:00:00Z");

    const result = await notify("u1", "commitment", {
      title: "Coach reminder",
      body: "Walk 10k",
      data: { entryId: 7 },
      context: { notebookEntryId: 7, content: "Walk 10k" },
      scheduledFor: when,
    });

    expect(storage.createPendingReminder).toHaveBeenCalledWith({
      userId: "u1",
      type: "commitment",
      context: { notebookEntryId: 7, content: "Walk 10k" },
      scheduledFor: when,
    });
    expect(sendPushToUser).toHaveBeenCalledWith(
      "u1",
      "Coach reminder",
      "Walk 10k",
      { entryId: 7 },
    );
    expect(storage.recordNotificationSend).not.toHaveBeenCalled();
    expect(result.pushDelivered).toBe(true);
  });

  it("meal-log → in-app only + ledger row (capped), no push", async () => {
    const when = new Date("2026-06-25T12:00:00Z");

    const result = await notify("u1", "meal-log", {
      context: { lastLoggedAt: null },
      scheduledFor: when,
    });

    expect(storage.createPendingReminder).toHaveBeenCalledWith({
      userId: "u1",
      type: "meal-log",
      context: { lastLoggedAt: null },
      scheduledFor: when,
    });
    expect(storage.recordNotificationSend).toHaveBeenCalledWith({
      userId: "u1",
      category: "meal-log",
      sentAt: when,
    });
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(result.pushDelivered).toBe(false);
  });
});
