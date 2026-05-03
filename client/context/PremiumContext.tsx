import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TIER_FEATURES,
  type SubscriptionTier,
  type SubscriptionStatus,
  type PremiumFeatures,
} from "@shared/types/premium";
import { useAuthContext } from "./AuthContext";

interface RecipeGenerationStatus {
  generationsToday: number;
  dailyLimit: number;
  canGenerate: boolean;
}

interface ReceiptScanStatus {
  count: number;
  limit: number;
  remaining: number;
}

interface PremiumContextType {
  tier: SubscriptionTier;
  features: PremiumFeatures;
  isPremium: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  dailyScanCount: number;
  canScanToday: boolean;
  recipeGenerationsToday: number;
  canGenerateRecipe: boolean;
  monthlyReceiptScans: number;
  receiptScanLimit: number;
  canScanReceipt: boolean;
  refreshSubscription: () => Promise<void>;
  refreshScanCount: () => Promise<void>;
  refreshRecipeGenerationStatus: () => Promise<void>;
  refreshReceiptScanCount: () => Promise<void>;
  refetch: () => Promise<void>;
}

const PremiumContext = createContext<PremiumContextType | null>(null);

const DEFAULT_FEATURES = TIER_FEATURES.free;

export function PremiumProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthContext();

  // Fetch subscription status
  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
    error: subscriptionError,
    refetch: refetchSubscription,
  } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch daily scan count
  const {
    data: scanCountData,
    isLoading: isScanCountLoading,
    isError: isScanCountError,
    error: scanCountError,
    refetch: refetchScanCount,
  } = useQuery<{ count: number }>({
    queryKey: ["/api/subscription/scan-count"],
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
  });

  // Fetch recipe generation status (only for premium users)
  const {
    data: recipeGenData,
    isLoading: isRecipeGenLoading,
    refetch: refetchRecipeGenStatus,
  } = useQuery<RecipeGenerationStatus>({
    queryKey: ["/api/recipes/generation-status"],
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
  });

  // Fetch receipt scan count (only for premium users)
  const isPremiumDerived =
    (subscriptionData?.tier ?? "free") === "premium" &&
    (subscriptionData?.isActive ?? false);
  const { data: receiptScanData, refetch: refetchReceiptScanCount } =
    useQuery<ReceiptScanStatus>({
      queryKey: ["/api/receipt/scan-count"],
      enabled: isAuthenticated && isPremiumDerived,
      staleTime: 60 * 1000, // 60 seconds
    });

  const tier = subscriptionData?.tier ?? "free";
  const features = subscriptionData?.features ?? DEFAULT_FEATURES;
  const isPremium = tier === "premium" && (subscriptionData?.isActive ?? false);
  const dailyScanCount = scanCountData?.count ?? 0;
  const canScanToday = isPremium || dailyScanCount < features.maxDailyScans;
  const recipeGenerationsToday = recipeGenData?.generationsToday ?? 0;
  const canGenerateRecipe = recipeGenData?.canGenerate ?? false;
  const monthlyReceiptScans = receiptScanData?.count ?? 0;
  const receiptScanLimit =
    receiptScanData?.limit ?? features.monthlyReceiptScans;
  const canScanReceipt = isPremium && monthlyReceiptScans < receiptScanLimit;

  const refreshSubscription = useCallback(async () => {
    await refetchSubscription();
  }, [refetchSubscription]);

  const refreshScanCount = useCallback(async () => {
    await refetchScanCount();
  }, [refetchScanCount]);

  const refreshRecipeGenerationStatus = useCallback(async () => {
    await refetchRecipeGenStatus();
  }, [refetchRecipeGenStatus]);

  const refreshReceiptScanCount = useCallback(async () => {
    await refetchReceiptScanCount();
  }, [refetchReceiptScanCount]);

  // Combined refetch for all status queries
  const refetch = useCallback(async () => {
    await Promise.all([
      refetchSubscription(),
      refetchScanCount(),
      refetchRecipeGenStatus(),
      refetchReceiptScanCount(),
    ]);
  }, [
    refetchSubscription,
    refetchScanCount,
    refetchRecipeGenStatus,
    refetchReceiptScanCount,
  ]);

  // Combine error states - prioritize subscription error as it's the primary query
  const isError = isSubscriptionError || isScanCountError;
  const error = subscriptionError ?? scanCountError ?? null;

  const contextValue = useMemo(
    () => ({
      tier,
      features,
      isPremium,
      isLoading:
        isSubscriptionLoading || isScanCountLoading || isRecipeGenLoading,
      isError,
      error,
      dailyScanCount,
      canScanToday,
      recipeGenerationsToday,
      canGenerateRecipe,
      monthlyReceiptScans,
      receiptScanLimit,
      canScanReceipt,
      refreshSubscription,
      refreshScanCount,
      refreshRecipeGenerationStatus,
      refreshReceiptScanCount,
      refetch,
    }),
    [
      tier,
      features,
      isPremium,
      isSubscriptionLoading,
      isScanCountLoading,
      isRecipeGenLoading,
      isError,
      error,
      dailyScanCount,
      canScanToday,
      recipeGenerationsToday,
      canGenerateRecipe,
      monthlyReceiptScans,
      receiptScanLimit,
      canScanReceipt,
      refreshSubscription,
      refreshScanCount,
      refreshRecipeGenerationStatus,
      refreshReceiptScanCount,
      refetch,
    ],
  );

  return (
    <PremiumContext.Provider value={contextValue}>
      {children}
    </PremiumContext.Provider>
  );
}

export function usePremiumContext(): PremiumContextType {
  const context = useContext(PremiumContext);
  if (!context) {
    throw new Error("usePremiumContext must be used within a PremiumProvider");
  }
  return context;
}
