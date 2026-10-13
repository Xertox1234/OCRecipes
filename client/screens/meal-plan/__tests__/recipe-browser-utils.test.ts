import { describe, it, expect } from "vitest";
import {
  resolveIdeasCtaState,
  computeActiveFilterCount,
  DEFAULT_FILTERS,
  detailParamsForSearchResult,
} from "../recipe-browser-utils";
import { ApiError } from "../../../lib/api-error";

describe("resolveIdeasCtaState", () => {
  const base = {
    isPremium: true,
    pending: false,
    error: null,
    hasIdeas: false,
  };
  it("locked for free users", () =>
    expect(resolveIdeasCtaState({ ...base, isPremium: false })).toBe("locked"));
  it("loading while pending", () =>
    expect(resolveIdeasCtaState({ ...base, pending: true })).toBe("loading"));
  it("error after a failure", () =>
    expect(
      resolveIdeasCtaState({
        ...base,
        error: new ApiError("502: AI unavailable", "AI_UNAVAILABLE", 502),
      }),
    ).toBe("error"));
  it("hidden once ideas are showing", () =>
    expect(resolveIdeasCtaState({ ...base, hasIdeas: true })).toBe("hidden"));
  it("idle otherwise", () => expect(resolveIdeasCtaState(base)).toBe("idle"));
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

describe("detailParamsForSearchResult", () => {
  it("opens a community result as community", () => {
    expect(
      detailParamsForSearchResult({ id: "community:17", source: "community" }),
    ).toEqual({ recipeId: 17, recipeType: "community" });
  });

  it("opens a personal result as mealPlan", () => {
    expect(
      detailParamsForSearchResult({ id: "personal:42", source: "personal" }),
    ).toEqual({ recipeId: 42, recipeType: "mealPlan" });
  });
});
