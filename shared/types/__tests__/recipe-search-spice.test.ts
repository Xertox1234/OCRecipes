import { describe, it, expect } from "vitest";
import { recipeSearchResponseSchema } from "../recipe-search";

function responseWith(extra: Record<string, unknown>) {
  return {
    results: [
      {
        id: "community:1",
        source: "community",
        userId: null,
        title: "Curry",
        description: null,
        ingredients: ["chili"],
        cuisine: null,
        dietTags: [],
        mealTypes: [],
        difficulty: null,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: 20,
        caloriesPerServing: null,
        proteinPerServing: null,
        carbsPerServing: null,
        fatPerServing: null,
        servings: null,
        imageUrl: null,
        sourceUrl: null,
        createdAt: null,
        isCanonical: false,
        allergens: [],
        ...extra,
      },
    ],
    total: 1,
    offset: 0,
    limit: 20,
    query: { q: null, filters: {}, sort: "relevance" },
  };
}

describe("recipeSearchResponseSchema spiceLevel", () => {
  it("keeps a valid spice level instead of stripping it", () => {
    const parsed = recipeSearchResponseSchema.parse(
      responseWith({ spiceLevel: "hot" }),
    );
    expect(parsed.results[0].spiceLevel).toBe("hot");
  });

  it("reads a missing or invalid value as null without failing", () => {
    for (const extra of [{}, { spiceLevel: null }, { spiceLevel: "fiery" }]) {
      const parsed = recipeSearchResponseSchema.safeParse(responseWith(extra));
      expect(parsed.success).toBe(true);
      expect(parsed.data?.results[0].spiceLevel).toBeNull();
    }
  });
});
