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
  // Meal planning features
  mealPlanning: boolean;
  aiMealSuggestions: boolean;
  extendedPlanRange: boolean;
  pantryTracking: boolean;
  mealConfirmation: boolean;
  dailyAiSuggestions: number;
  maxPlanDays: number;
}

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
    mealPlanning: true,
    aiMealSuggestions: false,
    extendedPlanRange: false,
    pantryTracking: false,
    mealConfirmation: false,
    dailyAiSuggestions: 0,
    maxPlanDays: 7,
  },
  premium: {
    maxDailyScans: Infinity,
    advancedBarcodes: true,
    highQualityCapture: true,
    videoRecording: true,
    photoAnalysis: true,
    macroGoals: true,
    recipeGeneration: true,
    dailyRecipeGenerations: 5,
    mealPlanning: true,
    aiMealSuggestions: true,
    extendedPlanRange: true,
    pantryTracking: true,
    mealConfirmation: true,
    dailyAiSuggestions: 10,
    maxPlanDays: 90,
  },
};

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  expiresAt: string | null;
  features: PremiumFeatures;
  isActive: boolean;
}

export type PremiumFeatureKey = keyof PremiumFeatures;
