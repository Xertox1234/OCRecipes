import { z } from "zod";

export const subscriptionTiers = ["free", "premium"] as const;
export type SubscriptionTier = (typeof subscriptionTiers)[number];

export const subscriptionTierSchema = z.enum(subscriptionTiers);

/** Type guard to validate if a string is a valid subscription tier. */
export function isValidSubscriptionTier(
  tier: string,
): tier is SubscriptionTier {
  return (subscriptionTiers as readonly string[]).includes(tier);
}

export interface PremiumFeatures {
  maxDailyScans: number;
  maxSavedItems: number;
  advancedBarcodes: boolean;
  highQualityCapture: boolean;
  videoRecording: boolean;
  photoAnalysis: boolean;
  macroGoals: boolean;
  recipeGeneration: boolean;
  dailyRecipeGenerations: number;
  aiMealSuggestions: boolean;
  extendedPlanRange: boolean;
  dailyAiSuggestions: number;
  pantryTracking: boolean;
  mealConfirmation: boolean;
  voiceLogging: boolean;
  dailyNlpLogs: number;
  aiCoach: boolean;
  dailyCoachMessages: number;
  coachPro: boolean;
  coachProDailyMessages: number;
  menuScanner: boolean;
  micronutrientTracking: boolean;
  receiptScanner: boolean;
  monthlyReceiptScans: number;
  recipePhotoImport: boolean;
  cookAndTrack: boolean;
  maxFavouriteRecipes: number;
  /** Save a Spoonacular catalog recipe (costs 1 quota unit per save). */
  catalogSave: boolean;
  /** Import a recipe from an arbitrary URL (triggers AI image generation). */
  urlImport: boolean;
  /** Parse natural-language text into food items via AI (`/api/food/parse-text`). */
  textFoodParsing: boolean;
  /** AI-generated item suggestions and their step-by-step instructions. */
  itemSuggestions: boolean;
}

/** Represents effectively unlimited scans (JSON-safe alternative to Infinity). */
export const UNLIMITED_SCANS = 999999;

export const TIER_FEATURES: Record<SubscriptionTier, PremiumFeatures> = {
  free: {
    maxDailyScans: 3,
    maxSavedItems: 6,
    advancedBarcodes: true,
    highQualityCapture: false,
    videoRecording: false,
    photoAnalysis: true,
    macroGoals: false,
    recipeGeneration: false,
    dailyRecipeGenerations: 0,
    aiMealSuggestions: false,
    extendedPlanRange: false,
    dailyAiSuggestions: 0,
    pantryTracking: false,
    mealConfirmation: false,
    voiceLogging: false,
    dailyNlpLogs: 5,
    aiCoach: true,
    dailyCoachMessages: 3,
    coachPro: false,
    coachProDailyMessages: 0,
    menuScanner: false,
    micronutrientTracking: false,
    receiptScanner: false,
    monthlyReceiptScans: 0,
    recipePhotoImport: false,
    cookAndTrack: false,
    maxFavouriteRecipes: 20,
    catalogSave: false,
    urlImport: false,
    textFoodParsing: false,
    itemSuggestions: false,
  },
  premium: {
    maxDailyScans: UNLIMITED_SCANS,
    maxSavedItems: UNLIMITED_SCANS,
    advancedBarcodes: true,
    highQualityCapture: true,
    videoRecording: true,
    photoAnalysis: true,
    macroGoals: true,
    recipeGeneration: true,
    dailyRecipeGenerations: 20, // raised from 5 — original limit was too low for real-world use
    aiMealSuggestions: true,
    extendedPlanRange: true,
    dailyAiSuggestions: 10,
    pantryTracking: true,
    mealConfirmation: true,
    voiceLogging: true,
    dailyNlpLogs: 999999,
    aiCoach: true,
    dailyCoachMessages: 999999,
    coachPro: true,
    coachProDailyMessages: 999999,
    menuScanner: true,
    micronutrientTracking: true,
    receiptScanner: true,
    monthlyReceiptScans: 15,
    recipePhotoImport: true,
    cookAndTrack: true,
    maxFavouriteRecipes: UNLIMITED_SCANS,
    catalogSave: true,
    urlImport: true,
    textFoodParsing: true,
    itemSuggestions: true,
  },
};

export type PremiumFeatureKey = keyof PremiumFeatures;

/**
 * Minimum verification streak (consecutive UTC days with >=1 verification)
 * required to unlock `extendedPlanRange` for free-tier users.
 */
export const VERIFICATION_STREAK_UNLOCK_THRESHOLD = 7;

/**
 * Apply verification-streak-based feature unlocks to a feature set.
 *
 * When `streak >= VERIFICATION_STREAK_UNLOCK_THRESHOLD`, returns a copy of
 * `features` with `extendedPlanRange: true`. Below the threshold, returns the
 * original `features` reference unchanged. The unlock is purely derived from
 * the current streak — it only ever flips `extendedPlanRange` to `true` and
 * never downgrades a feature the user already has.
 */
export function applyStreakUnlocks(
  features: PremiumFeatures,
  streak: number,
): PremiumFeatures {
  if (streak < VERIFICATION_STREAK_UNLOCK_THRESHOLD) return features;
  if (features.extendedPlanRange) return features;
  return { ...features, extendedPlanRange: true };
}

/**
 * Resolve the *effective* subscription tier, accounting for premium expiry.
 *
 * A stored `tier: "premium"` is only honoured while the subscription is still
 * active: either it has no `expiresAt` (lifetime) or `expiresAt` is in the
 * future. An expired-premium subscription resolves to `"free"`. The `"free"`
 * tier is always active.
 *
 * Shared by `GET /api/subscription/status` and the server-side tier-cache
 * resolver so the two cannot drift. Pure — no DB, no I/O.
 */
export function resolveEffectiveTier(
  tier: SubscriptionTier,
  expiresAt: Date | null,
): { effectiveTier: SubscriptionTier; isActive: boolean } {
  const isActive =
    tier === "free" || !expiresAt || expiresAt.getTime() > Date.now();
  return { effectiveTier: isActive ? tier : "free", isActive };
}

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  expiresAt: string | null;
  features: PremiumFeatures;
  isActive: boolean;
  /**
   * Feature keys currently granted by the verification-streak unlock (not the
   * base tier). `["extendedPlanRange"]` when the streak unlock is active, `[]`
   * otherwise.
   */
  streakUnlocks: PremiumFeatureKey[];
}
