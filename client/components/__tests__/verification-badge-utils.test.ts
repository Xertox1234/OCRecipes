import { describe, it, expect } from "vitest";
import {
  getBadgeConfig,
  getVerificationTier,
  getNextTier,
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
});
