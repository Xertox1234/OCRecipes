import type { VerificationNutrition } from "@shared/types/verification";

// Re-export so existing consumers continue to work
export type { VerificationNutrition } from "@shared/types/verification";

// `computeConsensus` and `CONSENSUS_THRESHOLD` moved to `server/lib/` so the
// storage layer can import them without violating the service→storage
// dependency direction. Re-exported here for existing consumers.
export {
  computeConsensus,
  CONSENSUS_THRESHOLD,
} from "../lib/verification-consensus";

/** Core macro fields compared for verification (5% tolerance) */
const COMPARISON_FIELDS = [
  "calories",
  "protein",
  "totalCarbs",
  "totalFat",
] as const;

/**
 * Check if two numeric values match within 5% relative tolerance.
 * Handles edge cases: both zero, one zero, very small values.
 */
export function valuesMatch(a: number, b: number): boolean {
  if (a === b) return true;
  if (a === 0 && b === 0) return true;
  // For very small values (< 2), use absolute tolerance of 1
  if (Math.abs(a) < 2 && Math.abs(b) < 2) {
    return Math.abs(a - b) <= 1;
  }
  const max = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / max <= 0.05;
}

/**
 * Compare extracted label data against existing verifications.
 * Uses 5% tolerance on core 4 macros. Null fields are ignored.
 * Returns whether this extraction matches the existing consensus.
 */
export function compareWithVerifications(
  extracted: VerificationNutrition,
  existing: VerificationNutrition[],
): { isMatch: boolean; matchCount: number } {
  if (existing.length === 0) {
    // First verification — always matches (nothing to compare against)
    return { isMatch: true, matchCount: 0 };
  }

  // Compare against each existing verification
  let matchCount = 0;
  for (const entry of existing) {
    if (nutritionMatches(extracted, entry)) {
      matchCount++;
    }
  }

  // Match if this extraction agrees with at least one existing verification
  // (consensus builds from pairwise agreement)
  return { isMatch: matchCount > 0, matchCount };
}

/**
 * Check if two nutrition extractions match on all non-null core fields.
 * Returns false if no fields were actually compared (both all-null).
 */
export function nutritionMatches(
  a: VerificationNutrition,
  b: VerificationNutrition,
): boolean {
  let comparedCount = 0;
  for (const field of COMPARISON_FIELDS) {
    const valA = a[field];
    const valB = b[field];
    // Skip if either value is null (incomplete OCR)
    if (valA == null || valB == null) continue;
    comparedCount++;
    if (!valuesMatch(valA, valB)) return false;
  }
  // At least one field must have been compared for a meaningful match
  return comparedCount > 0;
}

/**
 * Extract the core 4 macro fields from a LabelExtractionResult for verification.
 */
export function extractVerificationNutrition(labelData: {
  calories?: number | null;
  protein?: number | null;
  totalCarbs?: number | null;
  totalFat?: number | null;
}): VerificationNutrition {
  return {
    calories: labelData.calories ?? null,
    protein: labelData.protein ?? null,
    totalCarbs: labelData.totalCarbs ?? null,
    totalFat: labelData.totalFat ?? null,
  };
}
