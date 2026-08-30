import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// The globally-aliased shared RN mock (test/mocks/react-native.ts) — mutate
// Platform.OS per test and restore, per the codified convention
// (docs/solutions/conventions/inline-vi-mock-globally-aliased-modules-2026-05-13.md);
// a full vi.mock("react-native") replacement would make the iOS branch
// untestable here.
import { Platform } from "react-native";

import { setupNotificationChannel } from "../notifications";

const setNotificationChannelAsync = vi.fn();
vi.mock("expo-notifications", () => ({
  setNotificationChannelAsync: (...args: unknown[]) =>
    setNotificationChannelAsync(...args),
  AndroidImportance: { DEFAULT: 3 },
}));

describe("setupNotificationChannel", () => {
  const originalOS = Platform.OS;

  beforeEach(() => setNotificationChannelAsync.mockClear());
  afterEach(() => {
    (Platform as { OS: string }).OS = originalOS;
  });

  it("creates the Android channel without a custom sound key", async () => {
    // A string `sound` value is a CUSTOM sound filename to expo-notifications;
    // "default" is not a bundled file, so it logged a console error on every
    // Android launch — whose LogBox toast then covered the login screen's
    // bottom controls in dev builds. Omitting `sound` selects the system
    // default sound for the channel.
    (Platform as { OS: string }).OS = "android";
    await setupNotificationChannel();

    expect(setNotificationChannelAsync).toHaveBeenCalledTimes(1);
    const [channelId, config] = setNotificationChannelAsync.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(channelId).toBe("coach-reminders");
    expect(config).not.toHaveProperty("sound");
  });

  it("is a no-op on iOS — channels are an Android-only concept", async () => {
    (Platform as { OS: string }).OS = "ios";
    await setupNotificationChannel();

    expect(setNotificationChannelAsync).not.toHaveBeenCalled();
  });
});
