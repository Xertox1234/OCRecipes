import { describe, it, expect, vi, beforeEach } from "vitest";

import { setupNotificationChannel } from "../notifications";

const setNotificationChannelAsync = vi.fn();
vi.mock("expo-notifications", () => ({
  setNotificationChannelAsync: (...args: unknown[]) =>
    setNotificationChannelAsync(...args),
  AndroidImportance: { DEFAULT: 3 },
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

describe("setupNotificationChannel", () => {
  beforeEach(() => setNotificationChannelAsync.mockClear());

  it("creates the Android channel without a custom sound key", async () => {
    // A string `sound` value is a CUSTOM sound filename to expo-notifications;
    // "default" is not a bundled file, so it logged a console error on every
    // Android launch — whose LogBox toast then covered the login screen's
    // bottom controls in dev builds. Omitting `sound` selects the system
    // default sound for the channel.
    await setupNotificationChannel();

    expect(setNotificationChannelAsync).toHaveBeenCalledTimes(1);
    const [channelId, config] = setNotificationChannelAsync.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(channelId).toBe("coach-reminders");
    expect(config).not.toHaveProperty("sound");
  });
});
