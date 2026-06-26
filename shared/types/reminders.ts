export type ReminderType =
  | "meal-log"
  | "commitment"
  | "daily-checkin"
  | "user-set";

// "user-set" is intentionally excluded — user-initiated reminders cannot be muted
// by category because they are explicitly created by the user.
export type ReminderMutes = {
  "meal-log"?: boolean;
  commitment?: boolean;
  "daily-checkin"?: boolean;
};

/** Quiet-hours window in the user's local time, "HH:MM" 24h. */
export type NotificationQuietHours = { start: string; end: string };

/**
 * Phase 0 staging shape for the unified notification preferences. `categories`
 * is a VERBATIM copy of reminderMutes (muted-boolean semantics, today's keys) —
 * NOT read this phase; Phase 1 flips reads here and renames the keys.
 */
export type NotificationPrefs = {
  categories: ReminderMutes;
  quietHours: NotificationQuietHours;
  ambientPush: boolean;
  transactionalEnabled: boolean;
};

export type CoachContextItem =
  | { type: "meal-log"; lastLoggedAt: string | null }
  | { type: "commitment"; notebookEntryId: number; content: string }
  | { type: "daily-checkin"; calories: number }
  | { type: "user-set"; message: string };
