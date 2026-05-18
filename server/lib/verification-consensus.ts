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
