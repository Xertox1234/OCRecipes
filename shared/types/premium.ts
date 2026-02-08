import { z } from "zod";

export const subscriptionTiers = ["free", "premium"] as const;
export type SubscriptionTier = (typeof subscriptionTiers)[number];

export const subscriptionTierSchema = z.enum(subscriptionTiers);

export interface PremiumFeatures {
  maxDailyScans: number;
  advancedBarcodes: boolean;
  highQualityCapture: boolean;
  videoRecording: boolean;
  photoAnalysis: boolean;
  macroGoals: boolean;
  recipeGeneration: boolean;
  dailyRecipeGenerations: number;
}

/** Represents effectively unlimited scans (JSON-safe alternative to Infinity). */
export const UNLIMITED_SCANS = 999999;

export const TIER_FEATURES: Record<SubscriptionTier, PremiumFeatures> = {
  free: {
    maxDailyScans: 10,
    advancedBarcodes: false,
    highQualityCapture: false,
    videoRecording: false,
    photoAnalysis: true,
    macroGoals: false,
    recipeGeneration: false,
    dailyRecipeGenerations: 0,
  },
  premium: {
    maxDailyScans: UNLIMITED_SCANS,
    advancedBarcodes: true,
    highQualityCapture: true,
    videoRecording: true,
    photoAnalysis: true,
    macroGoals: true,
    recipeGeneration: true,
    dailyRecipeGenerations: 5,
  },
};

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  expiresAt: string | null;
  features: PremiumFeatures;
  isActive: boolean;
}

export type PremiumFeatureKey = keyof PremiumFeatures;
