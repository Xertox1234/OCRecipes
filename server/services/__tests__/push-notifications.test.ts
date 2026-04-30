import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../storage";

import { sendPushToUser } from "../push-notifications";

// vi.mock is hoisted above const declarations. Use vi.hoisted() so these
// mock functions are defined before the mock factories execute.
const expoMock = vi.hoisted(() => ({
  send: vi.fn(),
  chunk: vi.fn((msgs: unknown[]) => [msgs]),
  isToken: vi.fn().mockReturnValue(true),
}));

vi.mock("expo-server-sdk", () => ({
  default: class MockExpo {
    sendPushNotificationsAsync = expoMock.send;
    chunkPushNotifications = expoMock.chunk;
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
});
