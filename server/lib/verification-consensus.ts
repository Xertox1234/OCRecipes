import type {
  ConsensusNutritionData,
  VerificationNutrition,
} from "@shared/types/verification";
import { roundToOneDecimal } from "./math";

/**
 * Verification consensus primitives shared between the verification route and
 * the verification storage layer.
 *
 * These live in `lib/` (not `services/`) because `server/storage/verification.ts`
 * recomputes the aggregate authoritatively and must import `computeConsensus` /
 * `CONSENSUS_THRESHOLD`. The architecture rule forbids a storage module
 * importing from `services/`, so the shared pure-function logic belongs here.
 * `valuesMatch` is now also imported by `server/services/barcode-lookup.ts`
 * (a `services → lib` edge, always allowed) — `lib/` being a shared
 * dependency of both `storage/` and `services/` is the fuller architectural
 * justification for its placement.
 */

/** Consensus threshold — number of matching verifications needed */
export const CONSENSUS_THRESHOLD = 3;

/**
 * Compute consensus nutrition values from matching verifications.
 * Averages all non-null values across verifications.
 */
export function computeConsensus(
  verifications: VerificationNutrition[],
): ConsensusNutritionData {
  const sums = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const counts = { calories: 0, protein: 0, carbs: 0, fat: 0 };

  for (const v of verifications) {
    if (v.calories != null) {
      sums.calories += v.calories;
      counts.calories++;
    }
    if (v.protein != null) {
      sums.protein += v.protein;
      counts.protein++;
    }
    if (v.totalCarbs != null) {
      sums.carbs += v.totalCarbs;
      counts.carbs++;
    }
    if (v.totalFat != null) {
      sums.fat += v.totalFat;
      counts.fat++;
    }
  }

  return {
    calories:
      counts.calories > 0 ? Math.round(sums.calories / counts.calories) : 0,
    protein:
      counts.protein > 0 ? roundToOneDecimal(sums.protein / counts.protein) : 0,
    carbs: counts.carbs > 0 ? roundToOneDecimal(sums.carbs / counts.carbs) : 0,
    fat: counts.fat > 0 ? roundToOneDecimal(sums.fat / counts.fat) : 0,
  };
}

/** Core macro fields compared for verification (5% tolerance) */
const COMPARISON_FIELDS = [
  "calories",
  "protein",
  "totalCarbs",
  "totalFat",
] as const;

/**
 * Check if two numeric values match within a relative tolerance (default 5%).
 * Handles edge cases: both zero, one zero, very small values.
 *
 * `tolerance` lets other nutrition-agreement call sites (e.g. the OFF
 * self-consistency gate in `server/services/barcode-lookup.ts`, which needs
 * 15%) share this one relative-agreement policy instead of re-deriving it.
 */
export function valuesMatch(a: number, b: number, tolerance = 0.05): boolean {
  // Stryker disable next-line ConditionalExpression: equivalent for finite inputs — equal values also pass the downstream relative branch
  if (a === b) return true;
  // For very small values (< 2), use absolute tolerance of 1
  if (Math.abs(a) < 2 && Math.abs(b) < 2) {
    return Math.abs(a - b) <= 1;
  }
  const max = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / max <= tolerance;
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
