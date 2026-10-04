import type { IAPProduct } from "@/lib/iap/types";
import { BENEFITS, getCtaLabel, isCtaDisabled } from "../upgrade-modal-utils";

const WITH_TRIAL: IAPProduct = {
  productId: "com.ocrecipes.premium.annual",
  displayPrice: "$29.99",
  period: { count: 1, unit: "year" },
  introOffer: { kind: "free-trial", length: { count: 3, unit: "day" } },
  androidOfferToken: null,
};

describe("upgrade-modal-utils", () => {
  describe("BENEFITS", () => {
    it("has 4 benefit items", () => {
      expect(BENEFITS).toHaveLength(4);
    });

    it("each benefit has icon and label", () => {
      for (const benefit of BENEFITS) {
        expect(benefit).toHaveProperty("icon");
        expect(benefit).toHaveProperty("label");
        expect(typeof benefit.icon).toBe("string");
        expect(typeof benefit.label).toBe("string");
      }
    });
  });

  describe("getCtaLabel", () => {
    it('returns "Processing..." for loading state', () => {
      expect(getCtaLabel("loading")).toBe("Processing...");
    });

    it('returns "Processing..." for pending state', () => {
      expect(getCtaLabel("pending")).toBe("Processing...");
    });

    it('returns "Restoring..." for restoring state', () => {
      expect(getCtaLabel("restoring")).toBe("Restoring...");
    });

    it('returns "Welcome to Premium!" for success state', () => {
      expect(getCtaLabel("success")).toBe("Welcome to Premium!");
    });

    it('returns "Start 3-Day Free Trial" for idle state when the store reports the trial', () => {
      expect(getCtaLabel("idle", WITH_TRIAL)).toBe("Start 3-Day Free Trial");
    });

    it('returns "Start 3-Day Free Trial" for error state when the store reports the trial', () => {
      expect(getCtaLabel("error", WITH_TRIAL)).toBe("Start 3-Day Free Trial");
    });
  });

  describe("isCtaDisabled", () => {
    it("returns true for loading", () => {
      expect(isCtaDisabled("loading")).toBe(true);
    });

    it("returns true for pending", () => {
      expect(isCtaDisabled("pending")).toBe(true);
    });

    it("returns true for restoring", () => {
      expect(isCtaDisabled("restoring")).toBe(true);
    });

    it("returns true for success", () => {
      expect(isCtaDisabled("success")).toBe(true);
    });

    it("returns false for idle", () => {
      expect(isCtaDisabled("idle")).toBe(false);
    });

    it("returns false for error", () => {
      expect(isCtaDisabled("error")).toBe(false);
    });
  });
});
