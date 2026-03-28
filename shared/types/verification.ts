import { z } from "zod";

export const verificationLevels = [
  "unverified",
  "single_verified",
  "verified",
] as const;
export const verificationLevelSchema = z.enum(verificationLevels);
export type VerificationLevel = z.infer<typeof verificationLevelSchema>;

/** Extracted nutrition values relevant to verification comparison */
export interface VerificationNutrition {
  calories: number | null;
  protein: number | null;
  totalCarbs: number | null;
  totalFat: number | null;
}

/** Nutrition data shape stored as consensus in barcodeVerifications JSONB */
export const consensusNutritionSchema = z.object({
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});
export type ConsensusNutritionData = z.infer<typeof consensusNutritionSchema>;

/** Response from GET /api/verification/:barcode */
export interface VerificationStatusResponse {
  verificationLevel: VerificationLevel;
  verificationCount: number;
  consensusNutritionData: ConsensusNutritionData | null;
  hasFrontLabelData: boolean;
}

/** Response from POST /api/verification/submit */
export interface VerificationSubmitResponse {
  isMatch: boolean;
  verificationLevel: VerificationLevel;
  verificationCount: number;
  canScanFrontLabel: boolean;
}

/** Response from GET /api/verification/user-count */
export interface UserVerificationStats {
  count: number;
  frontLabelCount: number;
  compositeScore: number;
  streak: number;
}
