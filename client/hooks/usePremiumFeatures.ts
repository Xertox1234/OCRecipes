import { usePremiumContext } from "@/context/PremiumContext";
import type { PremiumFeatureKey } from "@shared/types/premium";
import { showsCoachPro } from "@/navigation/coachConversationRoute";
import {
  getBarcodeTypesForTier,
  isPremiumBarcodeType,
  type ExpoBarcodeType,
} from "@shared/types/camera";

/**
 * Check if a specific premium feature is enabled for the current user.
 */
export function usePremiumFeature(featureKey: PremiumFeatureKey): boolean {
  const { features } = usePremiumContext();

  const value = features[featureKey];
  if (typeof value === "boolean") {
    return value;
  }

  // For numeric features like maxDailyScans, consider them "enabled" if > 0
  return value > 0;
}

/**
 * Whether Coach conversations open in CoachPro: a Pro user, and also while the
 * plan is unknown (owner ruling 2026-11-02). See `showsCoachPro`.
 */
export function useShowsCoachPro(): boolean {
  const { isPremiumResolved } = usePremiumContext();
  return showsCoachPro(usePremiumFeature("coachPro"), isPremiumResolved);
}

/**
 * Get barcode types available for the current user's subscription tier.
 */
export function useAvailableBarcodeTypes(): ExpoBarcodeType[] {
  const { tier } = usePremiumContext();
  return getBarcodeTypesForTier(tier);
}

/**
 * Check if the user can use a specific barcode type.
 */
export function useCanUseBarcodeType(barcodeType: ExpoBarcodeType): boolean {
  const { isPremium } = usePremiumContext();

  // Free users can't use premium barcode types
  if (isPremiumBarcodeType(barcodeType) && !isPremium) {
    return false;
  }

  return true;
}

/**
 * Check if the user can perform a scan today (based on daily limits).
 */
export function useCanScanToday(): {
  canScan: boolean;
  remainingScans: number | null;
  dailyLimit: number;
  currentCount: number;
} {
  const { features, isPremium, dailyScanCount, canScanToday } =
    usePremiumContext();

  const dailyLimit = features.maxDailyScans;
  const remainingScans = isPremium
    ? null
    : Math.max(0, dailyLimit - dailyScanCount);

  return {
    canScan: canScanToday,
    remainingScans,
    dailyLimit,
    currentCount: dailyScanCount,
  };
}

/**
 * Combined hook for all premium camera features.
 */
export function usePremiumCamera(): {
  availableBarcodeTypes: ExpoBarcodeType[];
  canScan: boolean;
  remainingScans: number | null;
  isPremium: boolean;
  highQualityCapture: boolean;
  videoRecording: boolean;
} {
  const { features, isPremium, dailyScanCount, canScanToday, tier } =
    usePremiumContext();

  const availableBarcodeTypes = getBarcodeTypesForTier(tier);
  const dailyLimit = features.maxDailyScans;
  const remainingScans = isPremium
    ? null
    : Math.max(0, dailyLimit - dailyScanCount);

  return {
    availableBarcodeTypes,
    canScan: canScanToday,
    remainingScans,
    isPremium,
    highQualityCapture: features.highQualityCapture,
    videoRecording: features.videoRecording,
  };
}
