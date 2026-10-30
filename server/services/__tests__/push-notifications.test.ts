import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../storage";

import {
  sendPushToUser,
  checkPushReceipts,
  _resetPushReceiptsForTesting,
  PUSH_RECEIPT_DELAY_MS,
} from "../push-notifications";

// vi.mock is hoisted above const declarations. Use vi.hoisted() so these
// mock functions are defined before the mock factories execute.
const expoMock = vi.hoisted(() => ({
  send: vi.fn(),
  chunk: vi.fn((msgs: unknown[]) => [msgs]),
  isToken: vi.fn().mockReturnValue(true),
  getReceipts: vi.fn(),
  chunkReceiptIds: vi.fn((ids: string[]) => [ids]),
}));

vi.mock("expo-server-sdk", () => ({
  default: class MockExpo {
    sendPushNotificationsAsync = expoMock.send;
    chunkPushNotifications = expoMock.chunk;
    getPushNotificationReceiptsAsync = expoMock.getReceipts;
    chunkPushNotificationReceiptIds = expoMock.chunkReceiptIds;
    static isExpoPushToken = expoMock.isToken;
  },
}));

vi.mock("../../storage", () => ({
  storage: {
    getPushTokensForUser: vi.fn(),
    deletePushToken: vi.fn(),
  },
}));

vi.stubEnv("EXPO_ACCESS_TOKEN", "test-expo-token");

const VALID_TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
const VALID_TOKEN_2 = "ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]";

function mockToken(token: string, platform: "ios" | "android" = "ios") {
  return {
    id: 1,
    userId: "1",
    token,
    platform,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  expoMock.isToken.mockReturnValue(true);
  expoMock.chunk.mockImplementation((msgs: unknown[]) => [msgs]);
  expoMock.chunkReceiptIds.mockImplementation((ids: string[]) => [ids]);
  vi.mocked(storage.deletePushToken).mockResolvedValue(undefined);
  _resetPushReceiptsForTesting();
});

describe("sendPushToUser — ticket/token alignment (R12)", () => {
  it("prunes the token the error ticket belongs to when an earlier chunk threw", async () => {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(VALID_TOKEN),
      mockToken(VALID_TOKEN_2),
    ]);
    // One message per chunk; the first chunk's send fails outright.
    expoMock.chunk.mockImplementation((msgs: unknown[]) =>
      msgs.map((m) => [m]),
    );
    expoMock.send
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce([
        { status: "error", details: { error: "DeviceNotRegistered" } },
      ]);

    await sendPushToUser("1", "t", "b");

    expect(storage.deletePushToken).toHaveBeenCalledTimes(1);
    expect(storage.deletePushToken).toHaveBeenCalledWith("1", VALID_TOKEN_2);
  });
});

describe("checkPushReceipts (R12)", () => {
  async function sendOk(ticketId: string, token = VALID_TOKEN) {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(token),
    ]);
    expoMock.send.mockResolvedValueOnce([{ status: "ok", id: ticketId }]);
    await sendPushToUser("1", "t", "b");
  }

  it("does not ask for receipts before Expo has produced them", async () => {
    const t0 = Date.now();
    await sendOk("ticket-1");

    await checkPushReceipts(t0 + 1_000);
    expect(expoMock.getReceipts).not.toHaveBeenCalled();
  });

  it("prunes a token whose receipt reports DeviceNotRegistered", async () => {
    const t0 = Date.now();
    await sendOk("ticket-1");
    expoMock.getReceipts.mockResolvedValue({
      "ticket-1": {
        status: "error",
        message: "not registered",
        details: { error: "DeviceNotRegistered" },
      },
    });

    await checkPushReceipts(t0 + PUSH_RECEIPT_DELAY_MS + 1_000);

    expect(expoMock.getReceipts).toHaveBeenCalledWith(["ticket-1"]);
    expect(storage.deletePushToken).toHaveBeenCalledWith("1", VALID_TOKEN);
  });

  it("forgets a ticket once its receipt is read (ok receipts are not re-fetched)", async () => {
    const t0 = Date.now();
    await sendOk("ticket-1");
    expoMock.getReceipts.mockResolvedValue({ "ticket-1": { status: "ok" } });

    await checkPushReceipts(t0 + PUSH_RECEIPT_DELAY_MS + 1_000);
    await checkPushReceipts(t0 + PUSH_RECEIPT_DELAY_MS + 2_000);

    expect(expoMock.getReceipts).toHaveBeenCalledTimes(1);
    expect(storage.deletePushToken).not.toHaveBeenCalled();
  });

  it("keeps tickets for the next run when the receipt request fails", async () => {
    const t0 = Date.now();
    await sendOk("ticket-1");
    expoMock.getReceipts
      .mockRejectedValueOnce(new Error("expo down"))
      .mockResolvedValueOnce({
        "ticket-1": {
          status: "error",
          message: "not registered",
          details: { error: "DeviceNotRegistered" },
        },
      });

    await checkPushReceipts(t0 + PUSH_RECEIPT_DELAY_MS + 1_000);
    await checkPushReceipts(t0 + PUSH_RECEIPT_DELAY_MS + 2_000);

    expect(expoMock.getReceipts).toHaveBeenCalledTimes(2);
    expect(storage.deletePushToken).toHaveBeenCalledWith("1", VALID_TOKEN);
  });
});

describe("sendPushToUser", () => {
  it("returns false when user has no registered tokens", async () => {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([]);

    expect(await sendPushToUser("1", "title", "body")).toBe(false);
    expect(expoMock.send).not.toHaveBeenCalled();
  });

  it("returns false when all tokens fail Expo format validation", async () => {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken("invalid-raw-apns-token"),
    ]);
    expoMock.isToken.mockReturnValue(false);

    expect(await sendPushToUser("1", "title", "body")).toBe(false);
    expect(expoMock.send).not.toHaveBeenCalled();
  });

  it("returns true when at least one ticket has status ok", async () => {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(VALID_TOKEN),
    ]);
    expoMock.send.mockResolvedValue([{ status: "ok", id: "ticket-abc" }]);

    expect(
      await sendPushToUser("1", "Coach reminder", "Drink water", {
        entryId: 5,
      }),
    ).toBe(true);
  });

  it("returns false when all tickets have error status", async () => {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(VALID_TOKEN),
    ]);
    expoMock.send.mockResolvedValue([
      { status: "error", message: "ServiceUnavailable" },
    ]);

    expect(await sendPushToUser("1", "title", "body")).toBe(false);
  });

  it("deletes DeviceNotRegistered tokens; returns true if another ticket succeeded", async () => {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(VALID_TOKEN, "ios"),
      mockToken(VALID_TOKEN_2, "android"),
    ]);
    expoMock.send.mockResolvedValue([
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "ok", id: "xyz" },
    ]);
    vi.mocked(storage.deletePushToken).mockResolvedValue();

    const result = await sendPushToUser("1", "title", "body");

    expect(result).toBe(true);
    // Index 0 of validTokens (VALID_TOKEN) was DeviceNotRegistered
    expect(storage.deletePushToken).toHaveBeenCalledWith("1", VALID_TOKEN);
    expect(storage.deletePushToken).toHaveBeenCalledTimes(1);
  });

  it("does not delete tokens for non-DeviceNotRegistered errors", async () => {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(VALID_TOKEN),
    ]);
    expoMock.send.mockResolvedValue([
      { status: "error", message: "MessageRateExceeded" },
    ]);

    await sendPushToUser("1", "title", "body");

    expect(storage.deletePushToken).not.toHaveBeenCalled();
  });

  it("includes data payload and default sound in messages", async () => {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(VALID_TOKEN),
    ]);
    expoMock.send.mockResolvedValue([{ status: "ok", id: "t1" }]);

    await sendPushToUser("1", "title", "body", { entryId: 42 });

    const messages = expoMock.send.mock.calls[0][0];
    expect(messages[0].data).toEqual({ entryId: 42 });
    expect(messages[0].sound).toBe("default");
  });

  it("returns false when all chunk sends throw (network failure)", async () => {
    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(VALID_TOKEN),
    ]);
    expoMock.send.mockRejectedValue(new Error("network timeout"));

    // All chunks failed → tickets empty → accepted.length === 0
    expect(await sendPushToUser("1", "title", "body")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR #269 reliability-audit: per-chunk Promise.race send timeout
// ─────────────────────────────────────────────────────────────────────────────

describe("PR #269 — push send timeout via Promise.race", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false and clears the timer when sendPushNotificationsAsync hangs past PUSH_SEND_TIMEOUT_MS", async () => {
    vi.useFakeTimers();

    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(VALID_TOKEN),
    ]);
    // Never resolves — simulates a hung Expo endpoint
    expoMock.send.mockReturnValue(new Promise<never>(() => {}));

    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    const p = sendPushToUser("1", "title", "body");

    // Advance past PUSH_SEND_TIMEOUT_MS (30_000 ms); advanceTimersByTimeAsync
    // flushes microtasks so the race rejection propagates through the promise chain.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await p).toBe(false);
    // The finally block must have called clearTimeout to clean up the timer
    expect(clearSpy).toHaveBeenCalled();
  });

  it("resolves normally (no timeout fire) when send completes before the deadline", async () => {
    vi.useFakeTimers();

    vi.mocked(storage.getPushTokensForUser).mockResolvedValue([
      mockToken(VALID_TOKEN),
    ]);
    expoMock.send.mockResolvedValue([{ status: "ok", id: "t1" }]);

    const p = sendPushToUser("1", "title", "body");
    // Let pending microtasks settle (send resolved synchronously in mock)
    await vi.advanceTimersByTimeAsync(0);

    expect(await p).toBe(true);
  });
});

// The absent-EXPO_ACCESS_TOKEN path is covered in push-notifications-unconfigured.test.ts
// (a dedicated file that imports the module without the env var set, giving a fresh singleton).
