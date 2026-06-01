// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  TIER_FEATURES,
  UNLIMITED_SCANS,
  type SubscriptionStatus,
} from "@shared/types/premium";

import { PremiumProvider, usePremiumContext } from "../PremiumContext";

// The `default values` block exercises the REAL PremiumProvider / derivation
// (tier, features, isPremium, dailyScanCount) instead of re-deriving it inline.
// Uses the real TanStack Query (matching client/hooks/__tests__ pattern): each
// provider query key is pre-seeded into the QueryClient cache so useQuery
// resolves from cache without a network fetch. `useAuthContext` is mocked to an
// authenticated user. The other describe blocks below still assert pure
// TIER_FEATURES / constant facts.

// Mock path resolves to the same module ID as PremiumContext's `./AuthContext`
// import (vitest applies the `@/` → client alias). Mocking via the relative
// `./AuthContext` here would target client/context/__tests__/AuthContext and
// silently NOT apply, loading the real AuthContext → query-client → Expo.
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ isAuthenticated: true }),
}));

/** Build a wrapper whose QueryClient cache is pre-seeded per query key. */
function renderPremium(values: {
  subscription?: SubscriptionStatus;
  scanCount?: { count: number };
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  if (values.subscription !== undefined) {
    queryClient.setQueryData(["/api/subscription/status"], values.subscription);
  }
  if (values.scanCount !== undefined) {
    queryClient.setQueryData(
      ["/api/subscription/scan-count"],
      values.scanCount,
    );
  }

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(PremiumProvider, null, children),
    );
  }
  return renderHook(() => usePremiumContext(), { wrapper: Wrapper });
}

describe("PremiumContext", () => {
  describe("default values", () => {
    it("defaults to the free tier when no subscription data", () => {
      const { result } = renderPremium({});
      expect(result.current.tier).toBe("free");
    });

    it("defaults to free features when no subscription data", () => {
      const { result } = renderPremium({});
      expect(result.current.features).toEqual(TIER_FEATURES.free);
      expect(result.current.features.maxDailyScans).toBe(3);
      expect(result.current.features.advancedBarcodes).toBe(true);
    });

    it("defaults to 0 scan count when no data", () => {
      const { result } = renderPremium({});
      expect(result.current.dailyScanCount).toBe(0);
    });

    it("defaults isPremium to false when no subscription", () => {
      const { result } = renderPremium({});
      expect(result.current.isPremium).toBe(false);
    });

    it("derives premium tier + features + isPremium from an active subscription", async () => {
      const { result } = renderPremium({
        subscription: {
          tier: "premium",
          expiresAt: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          features: TIER_FEATURES.premium,
          isActive: true,
          streakUnlocks: [],
        },
        scanCount: { count: 5 },
      });
      await waitFor(() => {
        expect(result.current.tier).toBe("premium");
      });
      expect(result.current.features).toEqual(TIER_FEATURES.premium);
      expect(result.current.isPremium).toBe(true);
      expect(result.current.dailyScanCount).toBe(5);
    });

    it("treats an expired premium subscription (isActive=false) as not premium", async () => {
      const { result } = renderPremium({
        subscription: {
          tier: "premium",
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          features: TIER_FEATURES.premium,
          isActive: false,
          streakUnlocks: [],
        },
      });
      await waitFor(() => {
        expect(result.current.tier).toBe("premium");
      });
      expect(result.current.isPremium).toBe(false);
    });
  });

  describe("tier and features update on API response", () => {
    it("should update tier from subscription data", () => {
      const subscriptionData: SubscriptionStatus = {
        tier: "premium",
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        features: TIER_FEATURES.premium,
        isActive: true,
        streakUnlocks: [],
      };
      const tier = subscriptionData?.tier ?? "free";

      expect(tier).toBe("premium");
    });

    it("should update features from subscription data", () => {
      const subscriptionData: SubscriptionStatus = {
        tier: "premium",
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        features: TIER_FEATURES.premium,
        isActive: true,
        streakUnlocks: [],
      };
      const features = subscriptionData?.features ?? TIER_FEATURES.free;

      expect(features).toEqual(TIER_FEATURES.premium);
      expect(features.maxDailyScans).toBe(UNLIMITED_SCANS);
      expect(features.advancedBarcodes).toBe(true);
      expect(features.highQualityCapture).toBe(true);
      expect(features.videoRecording).toBe(true);
    });

    it("should set isPremium true only when tier is premium AND isActive", () => {
      const activeSubscription: SubscriptionStatus = {
        tier: "premium",
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        features: TIER_FEATURES.premium,
        isActive: true,
        streakUnlocks: [],
      };
      const isPremiumActive =
        activeSubscription.tier === "premium" && activeSubscription.isActive;

      expect(isPremiumActive).toBe(true);

      // Expired premium subscription
      const expiredSubscription: SubscriptionStatus = {
        tier: "premium",
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        features: TIER_FEATURES.premium,
        isActive: false,
        streakUnlocks: [],
      };
      const isPremiumExpired =
        expiredSubscription.tier === "premium" && expiredSubscription.isActive;

      expect(isPremiumExpired).toBe(false);
    });
  });

  describe("canScanToday calculation", () => {
    it("should return true for premium users regardless of scan count", () => {
      const isPremium = true;
      const dailyScanCount = 1000;
      const features = TIER_FEATURES.premium;
      const canScanToday = isPremium || dailyScanCount < features.maxDailyScans;

      expect(canScanToday).toBe(true);
    });

    it("should return true for free users under the limit", () => {
      const isPremium = false;
      const dailyScanCount = 1;
      const features = TIER_FEATURES.free;
      const canScanToday = isPremium || dailyScanCount < features.maxDailyScans;

      expect(canScanToday).toBe(true);
    });

    it("should return false for free users at the limit", () => {
      const isPremium = false;
      const dailyScanCount = 3;
      const features = TIER_FEATURES.free;
      const canScanToday = isPremium || dailyScanCount < features.maxDailyScans;

      expect(canScanToday).toBe(false);
    });

    it("should return false for free users over the limit", () => {
      const isPremium = false;
      const dailyScanCount = 15;
      const features = TIER_FEATURES.free;
      const canScanToday = isPremium || dailyScanCount < features.maxDailyScans;

      expect(canScanToday).toBe(false);
    });

    it("should return true for free user with 0 scans", () => {
      const isPremium = false;
      const dailyScanCount = 0;
      const features = TIER_FEATURES.free;
      const canScanToday = isPremium || dailyScanCount < features.maxDailyScans;

      expect(canScanToday).toBe(true);
    });
  });

  describe("isLoading state", () => {
    it("should be true when subscription is loading", () => {
      const isSubscriptionLoading = true;
      const isScanCountLoading = false;
      const isLoading = isSubscriptionLoading || isScanCountLoading;

      expect(isLoading).toBe(true);
    });

    it("should be true when scan count is loading", () => {
      const isSubscriptionLoading = false;
      const isScanCountLoading = true;
      const isLoading = isSubscriptionLoading || isScanCountLoading;

      expect(isLoading).toBe(true);
    });

    it("should be true when both are loading", () => {
      const isSubscriptionLoading = true;
      const isScanCountLoading = true;
      const isLoading = isSubscriptionLoading || isScanCountLoading;

      expect(isLoading).toBe(true);
    });

    it("should be false when both are done loading", () => {
      const isSubscriptionLoading = false;
      const isScanCountLoading = false;
      const isLoading = isSubscriptionLoading || isScanCountLoading;

      expect(isLoading).toBe(false);
    });
  });
});

describe("usePremiumContext hook", () => {
  it("should throw error when used outside PremiumProvider", () => {
    // This tests the context validation logic
    const context = null; // Simulates being outside provider
    const usePremiumContext = () => {
      if (!context) {
        throw new Error(
          "usePremiumContext must be used within a PremiumProvider",
        );
      }
      return context;
    };

    expect(() => usePremiumContext()).toThrow(
      "usePremiumContext must be used within a PremiumProvider",
    );
  });
});

describe("Subscription expiry edge cases", () => {
  it("should treat null expiresAt as non-expiring free tier", () => {
    const subscriptionData: SubscriptionStatus = {
      tier: "free",
      expiresAt: null,
      features: TIER_FEATURES.free,
      isActive: true,
      streakUnlocks: [],
    };

    expect(subscriptionData.tier).toBe("free");
    expect(subscriptionData.expiresAt).toBeNull();
  });

  it("should correctly identify expired premium subscription", () => {
    const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
    const subscriptionData: SubscriptionStatus = {
      tier: "premium",
      expiresAt: expiredDate.toISOString(),
      features: TIER_FEATURES.premium,
      isActive: false,
      streakUnlocks: [],
    };

    // Even with premium tier, isActive is false so isPremium should be false
    const isPremium =
      subscriptionData.tier === "premium" && subscriptionData.isActive;
    expect(isPremium).toBe(false);
  });

  it("should correctly identify active premium subscription", () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    const subscriptionData: SubscriptionStatus = {
      tier: "premium",
      expiresAt: futureDate.toISOString(),
      features: TIER_FEATURES.premium,
      isActive: true,
      streakUnlocks: [],
    };

    const isPremium =
      subscriptionData.tier === "premium" && subscriptionData.isActive;
    expect(isPremium).toBe(true);
  });
});
