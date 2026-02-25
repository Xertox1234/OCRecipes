/**
 * Shared types for fasting feature.
 *
 * API-facing types use `string` for dates (JSON serialization converts Date to string).
 * For Drizzle DB types, import FastingSchedule / FastingLog from shared/schema.
 */

/** Fasting schedule as returned by the API (dates serialized to strings). */
export interface ApiFastingSchedule {
  id: number;
  userId: string;
  protocol: string;
  fastingHours: number;
  eatingHours: number;
  eatingWindowStart: string | null;
  eatingWindowEnd: string | null;
  isActive: boolean | null;
}

/** Fasting log as returned by the API (dates serialized to strings). */
export interface ApiFastingLog {
  id: number;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  targetDurationHours: number;
  actualDurationMinutes: number | null;
  completed: boolean | null;
  note: string | null;
}

/** Computed fasting statistics derived from fasting logs. */
export interface FastingStats {
  totalFasts: number;
  completedFasts: number;
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
  averageDurationMinutes: number;
}
