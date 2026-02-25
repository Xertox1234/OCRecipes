/**
 * Shared types for medication / GLP-1 companion feature.
 *
 * API-facing types use `string` for dates (JSON serialization converts Date to string).
 * For Drizzle DB types, import MedicationLog from shared/schema.
 */

/** Medication log as returned by the API (dates serialized to strings). */
export interface ApiMedicationLog {
  id: number;
  userId: string;
  medicationName: string;
  brandName: string | null;
  dosage: string;
  takenAt: string;
  sideEffects: string[];
  appetiteLevel: number | null;
  notes: string | null;
}

/** GLP-1 insights computed from medication logs and weight data. */
export interface Glp1Insights {
  totalDoses: number;
  daysSinceStart: number | null;
  averageAppetiteLevel: number | null;
  appetiteTrend: "decreasing" | "stable" | "increasing" | null;
  commonSideEffects: { name: string; count: number }[];
  weightChangeSinceStart: number | null;
  lastDoseAt: string | null;
  nextDoseEstimate: string | null;
}
