import type { PendingReminder } from "@shared/schema";

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
