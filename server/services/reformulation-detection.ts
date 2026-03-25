import type { VerificationNutrition } from "./verification-comparison";
import { nutritionMatches } from "./verification-comparison";
import type { ConsensusNutritionData } from "@shared/types/verification";

/**
 * Number of total divergent scans (from distinct users) needed
 * to flag a product as possibly reformulated.
 */
export const REFORMULATION_THRESHOLD = 3;

/**
 * Check whether a non-matching verification scan on an already-verified product
 * represents a possible reformulation.
 *
 * Logic: count recent non-matching history entries from distinct users.
 * If >= REFORMULATION_THRESHOLD divergent scans exist, the product should be
 * flagged for re-verification.
 */
export function detectReformulation(
  consensus: ConsensusNutritionData,
  recentHistory: {
    extractedNutrition: VerificationNutrition;
    userId: string;
    isMatch: boolean;
  }[],
): { shouldFlag: boolean; divergentCount: number; distinctUsers: number } {
  // Build consensus as VerificationNutrition for comparison
  const consensusNutrition: VerificationNutrition = {
    calories: consensus.calories,
    protein: consensus.protein,
    totalCarbs: consensus.carbs,
    totalFat: consensus.fat,
  };

  // Count non-matching entries from distinct users
  const divergentUserIds = new Set<string>();
  let divergentCount = 0;

  for (const entry of recentHistory) {
    if (entry.isMatch === false) {
      // Double-check against consensus (not just peer comparison)
      const matchesConsensus = nutritionMatches(
        entry.extractedNutrition,
        consensusNutrition,
      );
      if (!matchesConsensus) {
        divergentCount++;
        divergentUserIds.add(entry.userId);
      }
    }
  }

  return {
    shouldFlag:
      divergentCount >= REFORMULATION_THRESHOLD && divergentUserIds.size >= 2,
    divergentCount,
    distinctUsers: divergentUserIds.size,
  };
}
