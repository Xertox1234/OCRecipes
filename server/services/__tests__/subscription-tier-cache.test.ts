import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveSubscriptionTierFeatures,
  _testInternals,
} from "../subscription-tier-cache";
import { storage } from "../../storage";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getUserVerificationStats: vi.fn(),
  },
}));

const mockGetSubscriptionStatus = vi.mocked(storage.getSubscriptionStatus);
const mockGetUserVerificationStats = vi.mocked(
  storage.getUserVerificationStats,
);

/** Minimal subscription status for tests. */
const premiumStatus = { tier: "premium" as const, expiresAt: null };
const freeStatus = { tier: "free" as const, expiresAt: null };

/** Verification stats with no streak — overridden per-test when a streak matters. */
const noStreakStats = {
  count: 0,
  frontLabelCount: 0,
  compositeScore: 0,
  streak: 0,
};

describe("subscription-tier-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testInternals.tierCache.clear();
    mockGetUserVerificationStats.mockResolvedValue(noStreakStats);
  });

  it("fetches subscription status on cache miss and returns features", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(premiumStatus);

    const features = await resolveSubscriptionTierFeatures("u1");

    expect(mockGetSubscriptionStatus).toHaveBeenCalledWith("u1");
    expect(features.recipeGeneration).toBe(true);
  });

  it("returns cached features on second call without hitting DB", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(freeStatus);

    await resolveSubscriptionTierFeatures("u2");
    await resolveSubscriptionTierFeatures("u2");

    expect(mockGetSubscriptionStatus).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expires", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(freeStatus);

    await resolveSubscriptionTierFeatures("u3");

    // Manually expire the cache entry
    const entry = _testInternals.tierCache.get("u3")!;
    entry.expiresAt = Date.now() - 1;

    await resolveSubscriptionTierFeatures("u3");

    expect(mockGetSubscriptionStatus).toHaveBeenCalledTimes(2);
  });

  it("falls back to free tier when subscription is undefined", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(undefined);

    const features = await resolveSubscriptionTierFeatures("u4");

    expect(features.recipeGeneration).toBe(false);
  });

  it("falls back to free tier for unrecognized tier string", async () => {
    // Cast needed: simulates a DB row with a legacy/invalid tier value
    mockGetSubscriptionStatus.mockResolvedValue({
      tier: "enterprise_vip",
      expiresAt: null,
    } as unknown as typeof freeStatus);

    const features = await resolveSubscriptionTierFeatures("u5");

    expect(features.recipeGeneration).toBe(false);
  });

  it("unlocks extendedPlanRange for a free user with a 7-day streak", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(freeStatus);
    mockGetUserVerificationStats.mockResolvedValue({
      ...noStreakStats,
      count: 7,
      compositeScore: 7,
      streak: 7,
    });

    const features = await resolveSubscriptionTierFeatures("u6");

    expect(features.extendedPlanRange).toBe(true);
  });

  it("does not unlock extendedPlanRange for a free user below the streak threshold", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(freeStatus);
    mockGetUserVerificationStats.mockResolvedValue({
      ...noStreakStats,
      count: 6,
      compositeScore: 6,
      streak: 6,
    });

    const features = await resolveSubscriptionTierFeatures("u7");

    expect(features.extendedPlanRange).toBe(false);
  });
});
