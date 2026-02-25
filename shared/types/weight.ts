/**
 * Shared types for weight tracking feature.
 *
 * API-facing types use `string` for dates (JSON serialization converts Date to string).
 * For Drizzle DB types, import WeightLog from shared/schema.
 */

/** Weight log as returned by the API (dates serialized to strings). */
export interface ApiWeightLog {
  id: number;
  userId: string;
  weight: string;
  source: string;
  note: string | null;
  loggedAt: string;
}

/** Weight trend data computed from weight logs. */
export interface WeightTrend {
  avg7Day: number | null;
  avg30Day: number | null;
  weeklyRateOfChange: number | null;
  projectedGoalDate: string | null;
  currentWeight: number | null;
  entries: number;
  goalWeight: number | null;
}
