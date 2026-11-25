import { describe, it, expect, vi, beforeEach } from "vitest";
import { nudgeAboutExpiringPantry } from "../pantry-expiry";
import { storage } from "../../../storage";
import { notify } from "../../notifications/notify";

vi.mock("../../../storage", () => ({
  storage: {
    getEffectiveTierForUser: vi.fn(),
    getPantryItemsExpiringBetween: vi.fn(),
    hasReminderSince: vi.fn(),
    claimNotificationSend: vi.fn(),
    createConversationWithAssistantMessage: vi.fn(),
    deleteChatConversation: vi.fn(),
  },
}));
vi.mock("../../notifications/notify", () => ({ notify: vi.fn() }));

const NOW = new Date("2026-11-25T16:00:00Z");
const item = (name: string) =>
  ({ id: 1, name }) as Awaited<
    ReturnType<typeof storage.getPantryItemsExpiringBetween>
  >[number];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
  vi.mocked(storage.getPantryItemsExpiringBetween).mockResolvedValue([
    item("Spinach"),
    item("Chicken"),
  ]);
  vi.mocked(storage.hasReminderSince).mockResolvedValue(false);
  vi.mocked(storage.claimNotificationSend).mockResolvedValue(true);
  vi.mocked(storage.createConversationWithAssistantMessage).mockResolvedValue({
    id: 77,
  } as Awaited<
    ReturnType<typeof storage.createConversationWithAssistantMessage>
  >);
  vi.mocked(notify).mockResolvedValue({ pushDelivered: true });
});

describe("nudgeAboutExpiringPantry", () => {
  it("opens a conversation with the Coach's message and pushes a link to it", async () => {
    const result = await nudgeAboutExpiringPantry("u1", NOW, "UTC");

    expect(result).toBe("sent");
    // From 16:00 today to 16:00 tomorrow, the user's time.
    expect(storage.getPantryItemsExpiringBetween).toHaveBeenCalledWith(
      "u1",
      new Date("2026-11-25T16:00:00Z"),
      new Date("2026-11-26T16:00:00Z"),
    );
    expect(storage.createConversationWithAssistantMessage).toHaveBeenCalledWith(
      "u1",
      "Expiring soon",
      "Your spinach and chicken expire within a day. Want an idea for using them up?",
      { kind: "proactive", trigger: "pantry-expiring" },
    );
    expect(notify).toHaveBeenCalledWith("u1", "pantry-expiring", {
      title: "Use it before it goes",
      body: "2 items in your pantry expire within a day.",
      data: {
        url: "ocrecipes://chat/77",
        type: "pantry-expiring",
        conversationId: 77,
      },
      scheduledFor: NOW,
    });
  });

  it("does nothing for a plan without pantry tracking", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    expect(await nudgeAboutExpiringPantry("u1", NOW, "UTC")).toBe(
      "skipped-no-pantry",
    );
    expect(storage.claimNotificationSend).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("uses the same window whenever the tick lands inside the hour", async () => {
    await nudgeAboutExpiringPantry(
      "u1",
      new Date("2026-11-25T16:00:07.120Z"),
      "UTC",
    );
    expect(storage.getPantryItemsExpiringBetween).toHaveBeenCalledWith(
      "u1",
      new Date("2026-11-25T16:00:00Z"),
      new Date("2026-11-26T16:00:00Z"),
    );
  });

  it("opens at 16:00 on the wall clock on the days the clocks change", async () => {
    const windowAt = async (iso: string) => {
      vi.mocked(storage.getPantryItemsExpiringBetween).mockClear();
      await nudgeAboutExpiringPantry("u1", new Date(iso), "America/Toronto");
      const [, from, to] = vi.mocked(storage.getPantryItemsExpiringBetween).mock
        .calls[0];
      return [from.toISOString(), to.toISOString()];
    };
    // Clocks go back on 2026-11-01: 16:00 is 20:00Z before and 21:00Z after,
    // so that window is 25 hours long.
    expect(await windowAt("2026-10-31T20:00:00Z")).toEqual([
      "2026-10-31T20:00:00.000Z",
      "2026-11-01T21:00:00.000Z",
    ]);
    expect(await windowAt("2026-11-01T21:00:00Z")).toEqual([
      "2026-11-01T21:00:00.000Z",
      "2026-11-02T21:00:00.000Z",
    ]);
    // Clocks go forward on 2026-03-08: 21:00Z before, 20:00Z after (23 hours).
    expect(await windowAt("2026-03-07T21:00:00Z")).toEqual([
      "2026-03-07T21:00:00.000Z",
      "2026-03-08T20:00:00.000Z",
    ]);
  });

  it("does nothing when nothing is about to expire, and spends no daily slot", async () => {
    vi.mocked(storage.getPantryItemsExpiringBetween).mockResolvedValue([]);
    expect(await nudgeAboutExpiringPantry("u1", NOW, "UTC")).toBe(
      "skipped-nothing-expiring",
    );
    expect(storage.claimNotificationSend).not.toHaveBeenCalled();
    // Most users have nothing expiring: their plan is never looked up.
    expect(storage.getEffectiveTierForUser).not.toHaveBeenCalled();
  });

  it("stays quiet on a day the Coach already pushed a follow-up", async () => {
    vi.mocked(storage.hasReminderSince).mockResolvedValue(true);
    expect(await nudgeAboutExpiringPantry("u1", NOW, "America/Toronto")).toBe(
      "skipped-already-pushed-today",
    );
    // Since the start of the user's own day (Toronto is UTC-5 in November).
    expect(storage.hasReminderSince).toHaveBeenCalledWith(
      "u1",
      "commitment",
      new Date("2026-11-25T05:00:00Z"),
    );
    expect(storage.claimNotificationSend).not.toHaveBeenCalled();
  });

  it("claims the day's slot before writing anything, and stops when it is taken", async () => {
    vi.mocked(storage.claimNotificationSend).mockResolvedValue(false);
    expect(await nudgeAboutExpiringPantry("u1", NOW, "UTC")).toBe(
      "skipped-daily-cap",
    );
    expect(storage.claimNotificationSend).toHaveBeenCalledWith({
      userId: "u1",
      category: "pantry-expiring",
      sentAt: NOW,
    });
    expect(
      storage.createConversationWithAssistantMessage,
    ).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("removes the conversation when the push reaches no device, and keeps the slot spent", async () => {
    vi.mocked(notify).mockResolvedValue({ pushDelivered: false });
    expect(await nudgeAboutExpiringPantry("u1", NOW, "UTC")).toBe(
      "not-delivered",
    );
    expect(storage.deleteChatConversation).toHaveBeenCalledWith(77, "u1");
  });

  it("keeps the conversation when the push throws: it may already be on the phone", async () => {
    vi.mocked(notify).mockRejectedValue(new Error("ledger down"));
    await expect(nudgeAboutExpiringPantry("u1", NOW, "UTC")).rejects.toThrow(
      "ledger down",
    );
    expect(storage.deleteChatConversation).not.toHaveBeenCalled();
  });
});
