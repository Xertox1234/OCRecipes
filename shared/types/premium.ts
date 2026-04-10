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
  weightTrend: boolean;
  exerciseAnalytics: boolean;
  voiceLogging: boolean;
  dailyNlpLogs: number;
  healthKitSync: boolean;
  adaptiveGoals: boolean;
  aiCoach: boolean;
  dailyCoachMessages: number;
  coachPro: boolean;
  coachProDailyMessages: number;
  advancedFasting: boolean;
  glp1Companion: boolean;
  menuScanner: boolean;
  micronutrientTracking: boolean;
  receiptScanner: boolean;
  monthlyReceiptScans: number;
  recipePhotoImport: boolean;
  cookAndTrack: boolean;
  maxFavouriteRecipes: number;
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
    weightTrend: false,
    exerciseAnalytics: false,
    voiceLogging: false,
    dailyNlpLogs: 5,
    healthKitSync: false,
    adaptiveGoals: false,
    aiCoach: true,
    dailyCoachMessages: 3,
    coachPro: false,
    coachProDailyMessages: 0,
    advancedFasting: false,
    glp1Companion: false,
    menuScanner: false,
    micronutrientTracking: false,
    receiptScanner: false,
    monthlyReceiptScans: 0,
    recipePhotoImport: false,
    cookAndTrack: false,
    maxFavouriteRecipes: 20,
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
    weightTrend: true,
    exerciseAnalytics: true,
    voiceLogging: true,
    dailyNlpLogs: 999999,
    healthKitSync: true,
    adaptiveGoals: true,
    aiCoach: true,
    dailyCoachMessages: 999999,
    coachPro: true,
    coachProDailyMessages: 999999,
    advancedFasting: true,
    glp1Companion: true,
    menuScanner: true,
    micronutrientTracking: true,
    receiptScanner: true,
    monthlyReceiptScans: 15,
    recipePhotoImport: true,
    cookAndTrack: true,
    maxFavouriteRecipes: UNLIMITED_SCANS,
  },
};

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  expiresAt: string | null;
  features: PremiumFeatures;
  isActive: boolean;
}

export type PremiumFeatureKey = keyof PremiumFeatures;
