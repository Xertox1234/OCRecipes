import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveSubscriptionTierFeatures,
  _testInternals,
} from "../subscription-tier-cache";
import { storage } from "../../storage";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
  },
}));

const mockGetSubscriptionStatus = vi.mocked(storage.getSubscriptionStatus);

/** Minimal subscription status for tests. */
const premiumStatus = { tier: "premium" as const, expiresAt: null };
const freeStatus = { tier: "free" as const, expiresAt: null };

describe("subscription-tier-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testInternals.tierCache.clear();
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
});
