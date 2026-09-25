import { describe, it, expect } from "vitest";
import {
  shouldGatePremiumSource,
  isQuotaExceededError,
  resolveOnlineCtaState,
  computeActiveFilterCount,
  DEFAULT_FILTERS,
} from "../recipe-browser-utils";
import { ApiError } from "../../../lib/api-error";

describe("shouldGatePremiumSource", () => {
  it("gates a free user selecting the Online (spoonacular) source", () => {
    expect(shouldGatePremiumSource("spoonacular", false)).toBe(true);
  });

  it("does not gate a premium user selecting the Online source", () => {
    expect(shouldGatePremiumSource("spoonacular", true)).toBe(false);
  });

  it("does not gate a free user selecting a local source", () => {
    expect(shouldGatePremiumSource("all", false)).toBe(false);
    expect(shouldGatePremiumSource("personal", false)).toBe(false);
    expect(shouldGatePremiumSource("community", false)).toBe(false);
  });
});

describe("isQuotaExceededError", () => {
  it("detects the catalog quota-exceeded ApiError", () => {
    const error = new ApiError("402: quota", "CATALOG_QUOTA_EXCEEDED");
    expect(isQuotaExceededError(error)).toBe(true);
  });

  it("returns false for an ApiError with a different code", () => {
    const error = new ApiError("500: server error", "INTERNAL_ERROR");
    expect(isQuotaExceededError(error)).toBe(false);
  });

  it("returns false for a non-ApiError value", () => {
    expect(isQuotaExceededError(new Error("network"))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError(undefined)).toBe(false);
  });
});

describe("resolveOnlineCtaState", () => {
  const d = {
    catalogDisabled: false,
    isPremium: false,
    hasQuery: true,
    onlineRequested: false,
    onlineLoading: false,
    quotaExhausted: false,
  };
  it("hidden when catalog disabled or query empty", () => {
    expect(resolveOnlineCtaState({ ...d, catalogDisabled: true })).toBe(
      "hidden",
    );
    expect(resolveOnlineCtaState({ ...d, hasQuery: false })).toBe("hidden");
  });
  it("premium-locked for free users with a query", () => {
    expect(resolveOnlineCtaState(d)).toBe("premium-locked");
  });
  it("premium flow: actionable → loading → quota-exhausted", () => {
    expect(resolveOnlineCtaState({ ...d, isPremium: true })).toBe("actionable");
    expect(
      resolveOnlineCtaState({
        ...d,
        isPremium: true,
        onlineRequested: true,
        onlineLoading: true,
      }),
    ).toBe("loading");
    expect(
      resolveOnlineCtaState({
        ...d,
        isPremium: true,
        onlineRequested: true,
        quotaExhausted: true,
      }),
    ).toBe("quota-exhausted");
  });
});

describe("computeActiveFilterCount", () => {
  it("is 0 for DEFAULT_FILTERS", () => {
    expect(computeActiveFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it("counts each non-default advanced-sheet field once", () => {
    expect(
      computeActiveFilterCount({
        ...DEFAULT_FILTERS,
        advanced: { ...DEFAULT_FILTERS.advanced, sort: "quickest" },
      }),
    ).toBe(1);
    expect(
      computeActiveFilterCount({
        ...DEFAULT_FILTERS,
        advanced: { ...DEFAULT_FILTERS.advanced, maxPrepTime: 30 },
      }),
    ).toBe(1);
    expect(
      computeActiveFilterCount({
        ...DEFAULT_FILTERS,
        advanced: { ...DEFAULT_FILTERS.advanced, maxCalories: 500 },
      }),
    ).toBe(1);
    expect(
      computeActiveFilterCount({
        ...DEFAULT_FILTERS,
        advanced: { ...DEFAULT_FILTERS.advanced, minProtein: 20 },
      }),
    ).toBe(1);
    expect(
      computeActiveFilterCount({
        ...DEFAULT_FILTERS,
        advanced: { ...DEFAULT_FILTERS.advanced, source: "personal" },
      }),
    ).toBe(1);
  });

  it("counts curatedOnly and safeForMe", () => {
    expect(
      computeActiveFilterCount({ ...DEFAULT_FILTERS, curatedOnly: true }),
    ).toBe(1);
    expect(
      computeActiveFilterCount({ ...DEFAULT_FILTERS, safeForMe: true }),
    ).toBe(1);
    expect(
      computeActiveFilterCount({
        ...DEFAULT_FILTERS,
        curatedOnly: true,
        safeForMe: true,
      }),
    ).toBe(2);
  });

  it("does not count chip-row filters that live outside the advanced sheet", () => {
    expect(
      computeActiveFilterCount({
        ...DEFAULT_FILTERS,
        activeCuisine: "Italian",
        activeDiet: "vegan",
        activeDifficulty: "easy",
        pantryMode: true,
      }),
    ).toBe(0);
  });
});
