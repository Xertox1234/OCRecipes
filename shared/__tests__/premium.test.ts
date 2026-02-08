import {
  subscriptionTiers,
  subscriptionTierSchema,
  TIER_FEATURES,
  UNLIMITED_SCANS,
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
      expect(freeFeatures.maxDailyScans).toBe(10);
      expect(freeFeatures.advancedBarcodes).toBe(false);
      expect(freeFeatures.highQualityCapture).toBe(false);
      expect(freeFeatures.videoRecording).toBe(false);
    });

    it("should have features for premium tier", () => {
      const premiumFeatures = TIER_FEATURES.premium;
      expect(premiumFeatures.maxDailyScans).toBe(UNLIMITED_SCANS);
      expect(premiumFeatures.advancedBarcodes).toBe(true);
      expect(premiumFeatures.highQualityCapture).toBe(true);
      expect(premiumFeatures.videoRecording).toBe(true);
    });

    it("should have all tiers covered", () => {
      subscriptionTiers.forEach((tier) => {
        expect(TIER_FEATURES[tier]).toBeDefined();
      });
    });
  });
});
