import {
  subscriptionTiers,
  subscriptionTierSchema,
  TIER_FEATURES,
  UNLIMITED_SCANS,
  VERIFICATION_STREAK_UNLOCK_THRESHOLD,
  applyStreakUnlocks,
} from "../types/premium";

describe("Premium Types", () => {
  describe("subscriptionTiers", () => {
    it("should include free and premium tiers", () => {
      expect(subscriptionTiers).toContain("free");
      expect(subscriptionTiers).toContain("premium");
      expect(subscriptionTiers.length).toBe(2);
    });
  });

  describe("subscriptionTierSchema", () => {
    it("should validate valid tiers", () => {
      expect(subscriptionTierSchema.parse("free")).toBe("free");
      expect(subscriptionTierSchema.parse("premium")).toBe("premium");
    });

    it("should reject invalid tiers", () => {
      expect(() => subscriptionTierSchema.parse("invalid")).toThrow();
      expect(() => subscriptionTierSchema.parse("")).toThrow();
      expect(() => subscriptionTierSchema.parse(123)).toThrow();
    });
  });

  describe("TIER_FEATURES", () => {
    it("should have features for free tier", () => {
      const freeFeatures = TIER_FEATURES.free;
      expect(freeFeatures.maxDailyScans).toBe(3);
      expect(freeFeatures.advancedBarcodes).toBe(true);
      expect(freeFeatures.highQualityCapture).toBe(false);
      expect(freeFeatures.videoRecording).toBe(false);
      expect(freeFeatures.aiMealSuggestions).toBe(false);
      expect(freeFeatures.extendedPlanRange).toBe(false);
      expect(freeFeatures.dailyAiSuggestions).toBe(0);
      expect(freeFeatures.aiCoach).toBe(true);
      expect(freeFeatures.dailyCoachMessages).toBe(3);
      expect(freeFeatures.maxFavouriteRecipes).toBe(20);
      expect(freeFeatures.textFoodParsing).toBe(false);
      expect(freeFeatures.itemSuggestions).toBe(false);
    });

    it("should have features for premium tier", () => {
      const premiumFeatures = TIER_FEATURES.premium;
      expect(premiumFeatures.maxDailyScans).toBe(UNLIMITED_SCANS);
      expect(premiumFeatures.advancedBarcodes).toBe(true);
      expect(premiumFeatures.highQualityCapture).toBe(true);
      expect(premiumFeatures.videoRecording).toBe(true);
      expect(premiumFeatures.aiMealSuggestions).toBe(true);
      expect(premiumFeatures.extendedPlanRange).toBe(true);
      expect(premiumFeatures.dailyAiSuggestions).toBe(10);
      expect(premiumFeatures.maxFavouriteRecipes).toBe(UNLIMITED_SCANS);
      expect(premiumFeatures.textFoodParsing).toBe(true);
      expect(premiumFeatures.itemSuggestions).toBe(true);
    });

    it("should have all tiers covered", () => {
      subscriptionTiers.forEach((tier) => {
        expect(TIER_FEATURES[tier]).toBeDefined();
      });
    });
  });

  describe("applyStreakUnlocks", () => {
    it("returns features unchanged below the threshold", () => {
      const base = TIER_FEATURES.free;
      const result = applyStreakUnlocks(
        base,
        VERIFICATION_STREAK_UNLOCK_THRESHOLD - 1,
      );
      expect(result).toBe(base);
      expect(result.extendedPlanRange).toBe(false);
    });

    it("unlocks extendedPlanRange at the threshold", () => {
      const result = applyStreakUnlocks(
        TIER_FEATURES.free,
        VERIFICATION_STREAK_UNLOCK_THRESHOLD,
      );
      expect(result.extendedPlanRange).toBe(true);
    });

    it("unlocks extendedPlanRange above the threshold", () => {
      const result = applyStreakUnlocks(
        TIER_FEATURES.free,
        VERIFICATION_STREAK_UNLOCK_THRESHOLD + 10,
      );
      expect(result.extendedPlanRange).toBe(true);
    });

    it("does not mutate the input features object", () => {
      const base = TIER_FEATURES.free;
      applyStreakUnlocks(base, VERIFICATION_STREAK_UNLOCK_THRESHOLD);
      expect(base.extendedPlanRange).toBe(false);
    });

    it("does not clobber other features when unlocking", () => {
      const result = applyStreakUnlocks(
        TIER_FEATURES.free,
        VERIFICATION_STREAK_UNLOCK_THRESHOLD,
      );
      expect(result.maxDailyScans).toBe(TIER_FEATURES.free.maxDailyScans);
      expect(result.pantryTracking).toBe(false);
      expect(result.recipeGeneration).toBe(false);
    });

    it("leaves premium users unaffected and returns the same reference", () => {
      const base = TIER_FEATURES.premium;
      const result = applyStreakUnlocks(
        base,
        VERIFICATION_STREAK_UNLOCK_THRESHOLD,
      );
      expect(result).toBe(base);
      expect(result.extendedPlanRange).toBe(true);
    });
  });
});
