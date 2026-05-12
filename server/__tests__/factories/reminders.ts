import type { PendingReminder, PushToken } from "@shared/schema";

const pendingReminderDefaults: PendingReminder = {
  id: 1,
  userId: "1",
  type: "daily-checkin",
  context: {},
  scheduledFor: new Date("2026-05-01T09:00:00Z"),
  acknowledgedAt: null,
  createdAt: new Date("2026-05-01T09:00:00Z"),
};

export function createMockPendingReminder(
  overrides: Partial<PendingReminder> = {},
): PendingReminder {
  return { ...pendingReminderDefaults, ...overrides };
}

const pushTokenDefaults: PushToken = {
  id: 1,
  userId: "1",
  token: "ExponentPushToken[test-token]",
  platform: "ios",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockPushToken(
  overrides: Partial<PushToken> = {},
): PushToken {
  return { ...pushTokenDefaults, ...overrides };
}
