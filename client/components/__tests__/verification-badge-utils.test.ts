import { describe, it, expect } from "vitest";
import {
  getBadgeConfig,
  getVerificationTier,
  getNextTier,
  getTierLabel,
} from "../verification-badge-utils";

describe("verification-badge-utils", () => {
  describe("getBadgeConfig", () => {
    it("returns gray config for unverified", () => {
      const config = getBadgeConfig("unverified");
      expect(config.label).toBe("Unverified");
      expect(config.icon).toBe("help-circle");
      expect(config.colorKey).toBe("textSecondary");
    });

    it("returns blue config for single_verified", () => {
      const config = getBadgeConfig("single_verified");
      expect(config.label).toBe("Partly Verified");
      expect(config.icon).toBe("check-circle");
      expect(config.colorKey).toBe("info");
    });

    it("returns green config for verified", () => {
      const config = getBadgeConfig("verified");
      expect(config.label).toBe("Verified");
      expect(config.icon).toBe("shield");
      expect(config.colorKey).toBe("success");
    });

    it("includes accessibility labels for all levels", () => {
      expect(getBadgeConfig("unverified").a11yLabel).toContain("Unverified");
      expect(getBadgeConfig("single_verified").a11yLabel).toContain("Partly");
      expect(getBadgeConfig("verified").a11yLabel).toContain("Community");
    });
  });

  describe("getVerificationTier", () => {
    it("returns null for 0 verifications", () => {
      expect(getVerificationTier(0)).toBeNull();
    });

    it("returns 1 for 1-4 verifications", () => {
      expect(getVerificationTier(1)).toBe(1);
      expect(getVerificationTier(4)).toBe(1);
    });

    it("returns 5 for 5-9 verifications", () => {
      expect(getVerificationTier(5)).toBe(5);
      expect(getVerificationTier(9)).toBe(5);
    });

    it("returns 100 for 100+ verifications", () => {
      expect(getVerificationTier(100)).toBe(100);
      expect(getVerificationTier(500)).toBe(100);
    });

    // Composite score tests (back-label=1.0, front-label=0.5)
    it("handles decimal composite scores correctly", () => {
      // 5 back-label + 2 front-label = 5 + 1.0 = 6.0 → tier 5
      expect(getVerificationTier(6.0)).toBe(5);
      // 9 back-label + 1 front-label = 9 + 0.5 = 9.5 → tier 5 (not 10)
      expect(getVerificationTier(9.5)).toBe(5);
      // 10 back-label + 0 front-label = 10.0 → tier 10
      expect(getVerificationTier(10.0)).toBe(10);
      // 4 back-label + 1 front-label = 4 + 0.5 = 4.5 → tier 1 (not 5)
      expect(getVerificationTier(4.5)).toBe(1);
      // 0 back-label + 1 front-label = 0.5 → null (below tier 1)
      expect(getVerificationTier(0.5)).toBeNull();
    });
  });

  describe("getNextTier", () => {
    it("returns 1 for 0 verifications", () => {
      expect(getNextTier(0)).toBe(1);
    });

    it("returns 5 for 1-4 verifications", () => {
      expect(getNextTier(1)).toBe(5);
      expect(getNextTier(4)).toBe(5);
    });

    it("returns null when at max tier", () => {
      expect(getNextTier(100)).toBeNull();
      expect(getNextTier(200)).toBeNull();
    });
  });

  describe("getTierLabel", () => {
    it("returns null for 0 verifications", () => {
      expect(getTierLabel(0)).toBeNull();
    });

    it("returns Newcomer for 1-4", () => {
      expect(getTierLabel(1)).toBe("Newcomer");
      expect(getTierLabel(4)).toBe("Newcomer");
    });

    it("returns Contributor for 5-9", () => {
      expect(getTierLabel(5)).toBe("Contributor");
    });

    it("returns Bronze Verifier for 10-24", () => {
      expect(getTierLabel(10)).toBe("Bronze Verifier");
    });

    it("returns Silver Verifier for 25-49", () => {
      expect(getTierLabel(25)).toBe("Silver Verifier");
    });

    it("returns Gold Verifier for 50-99", () => {
      expect(getTierLabel(50)).toBe("Gold Verifier");
    });

    it("returns Platinum Verifier for 100+", () => {
      expect(getTierLabel(100)).toBe("Platinum Verifier");
      expect(getTierLabel(500)).toBe("Platinum Verifier");
    });
  });
});
