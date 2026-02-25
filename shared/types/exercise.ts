/**
 * Shared types for exercise tracking feature.
 *
 * API-facing types use `string` for dates (JSON serialization converts Date to string).
 * For Drizzle DB types, import ExerciseLog / ExerciseLibraryEntry from shared/schema.
 */

/** Exercise log as returned by the API (dates serialized to strings). */
export interface ApiExerciseLog {
  id: number;
  userId: string;
  exerciseName: string;
  exerciseType: string;
  durationMinutes: number;
  caloriesBurned: string | null;
  intensity: string | null;
  sets: number | null;
  reps: number | null;
  weightLifted: string | null;
  distanceKm: string | null;
  source: string;
  notes: string | null;
  loggedAt: string;
}

/** Exercise library entry as returned by the API. */
export interface ApiExerciseLibraryEntry {
  id: number;
  name: string;
  type: string;
  metValue: string;
  isCustom: boolean;
}

/** Daily exercise summary. */
export interface ExerciseSummary {
  totalCaloriesBurned: number;
  totalMinutes: number;
  exerciseCount: number;
}
