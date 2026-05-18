import type { VerificationNutrition } from "@shared/types/verification";

// Re-export shared verification types so existing consumers continue to work.
export type { VerificationNutrition } from "@shared/types/verification";

// `computeConsensus`, `CONSENSUS_THRESHOLD`, and the comparison primitives
// (`valuesMatch`, `nutritionMatches`, `compareWithVerifications`) live in
// `server/lib/` so the storage layer can import them without violating the
// service→storage dependency direction. Re-exported here for existing consumers.
export {
  computeConsensus,
  CONSENSUS_THRESHOLD,
  valuesMatch,
  nutritionMatches,
  compareWithVerifications,
} from "../lib/verification-consensus";

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
