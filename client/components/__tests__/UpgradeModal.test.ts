import { describe, it, expect } from "vitest";
import type { PurchaseError } from "@shared/types/subscription";
import type { IAPProduct } from "@/lib/iap/types";
import {
  BENEFITS,
  getCtaLabel,
  getPriceLine,
  getRenewalTerms,
  getTrialLine,
  getUpgradeErrorMessage,
  isCtaDisabled,
} from "../upgrade-modal-utils";

const ANNUAL: IAPProduct = {
  productId: "com.ocrecipes.premium.annual",
  displayPrice: "$29.99",
  period: { count: 1, unit: "year" },
  introOffer: null,
  androidOfferToken: null,
};

const ANNUAL_WITH_TRIAL: IAPProduct = {
  ...ANNUAL,
  introOffer: { kind: "free-trial", length: { count: 3, unit: "day" } },
};

describe("BENEFITS constant", () => {
  it("has exactly 4 benefits", () => {
    expect(BENEFITS).toHaveLength(4);
  });

  it("each benefit has icon and label", () => {
    for (const benefit of BENEFITS) {
      expect(typeof benefit.icon).toBe("string");
      expect(typeof benefit.label).toBe("string");
      expect(benefit.label.length).toBeGreaterThan(0);
    }
  });

  it("includes unlimited scans benefit", () => {
    expect(BENEFITS.some((b) => b.label.includes("Unlimited"))).toBe(true);
  });

  it("includes recipe generation benefit", () => {
    expect(BENEFITS.some((b) => b.label.includes("recipe"))).toBe(true);
  });
});

describe("getCtaLabel", () => {
  it("returns processing label for loading state", () => {
    expect(getCtaLabel("loading")).toBe("Processing...");
  });

  it("returns processing label for pending state", () => {
    expect(getCtaLabel("pending")).toBe("Processing...");
  });

  it("returns restoring label for restoring state", () => {
    expect(getCtaLabel("restoring")).toBe("Restoring...");
  });

  it("returns welcome label for success state", () => {
    expect(getCtaLabel("success")).toBe("Welcome to Premium!");
  });

  it("offers the free trial only when the store reports one", () => {
    expect(getCtaLabel("idle", ANNUAL_WITH_TRIAL)).toBe(
      "Start 3-Day Free Trial",
    );
    expect(getCtaLabel("error", ANNUAL_WITH_TRIAL)).toBe(
      "Start 3-Day Free Trial",
    );
    expect(getCtaLabel("cancelled", ANNUAL_WITH_TRIAL)).toBe(
      "Start 3-Day Free Trial",
    );
  });

  it("says Subscribe when there is no trial or no product", () => {
    expect(getCtaLabel("idle", ANNUAL)).toBe("Subscribe");
    expect(getCtaLabel("idle", null)).toBe("Subscribe");
  });

  it("names other trial lengths", () => {
    expect(
      getCtaLabel("idle", {
        ...ANNUAL,
        introOffer: { kind: "free-trial", length: { count: 1, unit: "week" } },
      }),
    ).toBe("Start 1-Week Free Trial");
  });
});

describe("isCtaDisabled", () => {
  it("is disabled during loading", () => {
    expect(isCtaDisabled("loading")).toBe(true);
  });

  it("is disabled during pending", () => {
    expect(isCtaDisabled("pending")).toBe(true);
  });

  it("is disabled during restoring", () => {
    expect(isCtaDisabled("restoring")).toBe(true);
  });

  it("is disabled on success", () => {
    expect(isCtaDisabled("success")).toBe(true);
  });

  it("is enabled on idle", () => {
    expect(isCtaDisabled("idle")).toBe(false);
  });

  it("is enabled on error", () => {
    expect(isCtaDisabled("error")).toBe(false);
  });

  it("is enabled on cancelled", () => {
    expect(isCtaDisabled("cancelled")).toBe(false);
  });

  it("is disabled until the product has loaded from the store", () => {
    expect(isCtaDisabled("idle", false)).toBe(true);
    expect(isCtaDisabled("idle", true)).toBe(false);
  });
});

describe("getPriceLine", () => {
  it("shows the store's price per period", () => {
    expect(getPriceLine(ANNUAL)).toBe("$29.99 per year");
    expect(
      getPriceLine({ ...ANNUAL, period: { count: 3, unit: "month" } }),
    ).toBe("$29.99 every 3 months");
  });

  it("shows the bare price when the store gave no period", () => {
    expect(getPriceLine({ ...ANNUAL, period: null })).toBe("$29.99");
  });

  it("never invents a price before the store answers", () => {
    expect(getPriceLine(null)).toBe("Price unavailable");
  });
});

describe("getTrialLine", () => {
  it("states what is charged after the trial", () => {
    expect(getTrialLine(ANNUAL_WITH_TRIAL)).toBe(
      "Free for 3 days, then $29.99 per year.",
    );
  });

  it("is absent without a trial", () => {
    expect(getTrialLine(ANNUAL)).toBeNull();
    expect(getTrialLine(null)).toBeNull();
  });
});

describe("getRenewalTerms", () => {
  it("states auto-renewal, the price, and where to cancel on iOS", () => {
    const terms = getRenewalTerms(ANNUAL, "ios");
    expect(terms).toContain("renews automatically");
    expect(terms).toContain("$29.99 per year");
    expect(terms).toContain("App Store");
    expect(terms).toContain("24 hours");
  });

  it("names Google Play on Android", () => {
    expect(getRenewalTerms(ANNUAL, "android")).toContain("Google Play");
  });

  it("says the charge comes when the trial ends", () => {
    expect(getRenewalTerms(ANNUAL_WITH_TRIAL, "ios")).toContain(
      "when the free trial ends",
    );
  });

  it("is absent before the product loads", () => {
    expect(getRenewalTerms(null, "ios")).toBeNull();
  });
});

describe("getUpgradeErrorMessage", () => {
  it.each<[PurchaseError["code"] | undefined, string]>([
    ["NETWORK", "Network error. Check your connection and try again."],
    ["ALREADY_OWNED", "You already own this subscription."],
    [
      "STORE_UNAVAILABLE",
      "The store is currently unavailable. Try again later.",
    ],
    ["NOTHING_TO_RESTORE", "No previous purchase was found to restore."],
    [
      "PENDING_APPROVAL",
      "Your purchase is waiting for approval. Premium unlocks once it's approved.",
    ],
    [undefined, "Could not complete the upgrade. Please try again."],
  ])("gives fixed copy for %s", (code, copy) => {
    expect(getUpgradeErrorMessage(code)).toBe(copy);
  });
});
