import React, {
  createContext,
  useContext,
  useCallback,
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
  refreshSubscription: () => Promise<void>;
  refreshScanCount: () => Promise<void>;
  refreshRecipeGenerationStatus: () => Promise<void>;
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

  const tier = subscriptionData?.tier ?? "free";
  const features = subscriptionData?.features ?? DEFAULT_FEATURES;
  const isPremium = tier === "premium" && (subscriptionData?.isActive ?? false);
  const dailyScanCount = scanCountData?.count ?? 0;
  const canScanToday = isPremium || dailyScanCount < features.maxDailyScans;
  const recipeGenerationsToday = recipeGenData?.generationsToday ?? 0;
  const canGenerateRecipe = recipeGenData?.canGenerate ?? false;

  const refreshSubscription = useCallback(async () => {
    await refetchSubscription();
  }, [refetchSubscription]);

  const refreshScanCount = useCallback(async () => {
    await refetchScanCount();
  }, [refetchScanCount]);

  const refreshRecipeGenerationStatus = useCallback(async () => {
    await refetchRecipeGenStatus();
  }, [refetchRecipeGenStatus]);

  // Combined refetch for all status queries
  const refetch = useCallback(async () => {
    await Promise.all([
      refetchSubscription(),
      refetchScanCount(),
      refetchRecipeGenStatus(),
    ]);
  }, [refetchSubscription, refetchScanCount, refetchRecipeGenStatus]);

  // Combine error states - prioritize subscription error as it's the primary query
  const isError = isSubscriptionError || isScanCountError;
  const error = subscriptionError ?? scanCountError ?? null;

  return (
    <PremiumContext.Provider
      value={{
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
        refreshSubscription,
        refreshScanCount,
        refreshRecipeGenerationStatus,
        refetch,
      }}
    >
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
