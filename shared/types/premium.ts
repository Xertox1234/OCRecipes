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
    dailyRecipeGenerations: 5,
    aiMealSuggestions: true,
    extendedPlanRange: true,
    dailyAiSuggestions: 10,
    pantryTracking: true,
    mealConfirmation: true,
  },
};

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  expiresAt: string | null;
  features: PremiumFeatures;
  isActive: boolean;
}

export type PremiumFeatureKey = keyof PremiumFeatures;
