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

export type CoachContextItem =
  | { type: "meal-log"; lastLoggedAt: string | null }
  | { type: "commitment"; notebookEntryId: number; content: string }
  | { type: "daily-checkin"; calories: number }
  | { type: "user-set"; message: string };
