export type ReminderType =
  | "meal-log"
  | "commitment"
  | "daily-checkin"
  | "user-set";

export type ReminderMutes = {
  "meal-log"?: boolean;
  commitment?: boolean;
  "daily-checkin"?: boolean;
};

export type CoachContextItem =
  | { type: "meal-log"; mealType: string; lastLoggedAt: string | null }
  | { type: "commitment"; notebookEntryId: number; content: string }
  | { type: "daily-checkin"; calories: number; goal: number }
  | { type: "user-set"; message: string };
