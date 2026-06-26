import { describe, it, expect } from "vitest";
import {
  parseSearchableRecipeNumericId,
  toCarouselCard,
  DISCOVERY_PRESETS,
  DISCOVERY_STALE_TIME_MS,
} from "../recipe-discovery-utils";
import type { SearchableRecipe } from "@shared/types/recipe-search";

const base: SearchableRecipe = {
  id: "community:17",
  source: "community",
  userId: null,
  title: "Red Thai Curry",
  description: null,
  ingredients: [],
  cuisine: "Thai",
  dietTags: [],
  mealTypes: [],
  difficulty: null,
  prepTimeMinutes: null,
  cookTimeMinutes: null,
  totalTimeMinutes: 30,
  caloriesPerServing: 520,
  proteinPerServing: null,
  carbsPerServing: null,
  fatPerServing: null,
  servings: null,
  imageUrl: "img/x.png",
  sourceUrl: null,
  createdAt: null,
  isCanonical: true,
  allergens: [],
};

describe("parseSearchableRecipeNumericId", () => {
  it("extracts the numeric portion after the source prefix", () => {
    expect(parseSearchableRecipeNumericId("community:17")).toBe(17);
    expect(parseSearchableRecipeNumericId("personal:42")).toBe(42);
  });
});

describe("toCarouselCard", () => {
  it("maps fields and prefers calories for the meta line", () => {
    const card = toCarouselCard(base);
    expect(card).toEqual({
      id: 17,
      title: "Red Thai Curry",
      imageUrl: "img/x.png",
      prepTimeMinutes: 30,
      recommendationReason: "520 cal",
      isCanonical: true,
    });
  });

  it("falls back to total time, then cuisine, then empty string", () => {
    expect(
      toCarouselCard({ ...base, caloriesPerServing: null })
        .recommendationReason,
    ).toBe("30 min");
    expect(
      toCarouselCard({
        ...base,
        caloriesPerServing: null,
        totalTimeMinutes: null,
      }).recommendationReason,
    ).toBe("Thai");
    expect(
      toCarouselCard({
        ...base,
        caloriesPerServing: null,
        totalTimeMinutes: null,
        cuisine: null,
      }).recommendationReason,
    ).toBe("");
  });
});

describe("DISCOVERY_PRESETS", () => {
  it("defines pantry (premium), quick, and featured rows with local-only params", () => {
    const keys = DISCOVERY_PRESETS.map((p) => p.key);
    expect(keys).toEqual(["pantry", "quick", "featured"]);
    const pantry = DISCOVERY_PRESETS.find((p) => p.key === "pantry")!;
    expect(pantry.premiumOnly).toBe(true);
    expect(pantry.params.pantry).toBe(true);
    const quick = DISCOVERY_PRESETS.find((p) => p.key === "quick")!;
    expect(quick.params).toMatchObject({ maxPrepTime: 20, sort: "quickest" });
    expect(
      DISCOVERY_PRESETS.find((p) => p.key === "featured")!.params.curatedOnly,
    ).toBe(true);
    // No preset targets the Spoonacular source (discovery is local-only by construction).
    expect(
      DISCOVERY_PRESETS.every((p) => p.params.source !== "spoonacular"),
    ).toBe(true);
  });

  it("uses a 5-minute stale time", () => {
    expect(DISCOVERY_STALE_TIME_MS).toBe(5 * 60_000);
  });
});
