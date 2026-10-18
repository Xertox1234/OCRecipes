import { describe, it, expect } from "vitest";
import { recipeSearchResponseSchema } from "../recipe-search";

function responseWith(extra: Record<string, unknown>) {
  return {
    results: [
      {
        id: "community:1",
        source: "community",
        userId: null,
        title: "Salad",
        description: null,
        ingredients: ["lettuce"],
        cuisine: null,
        dietTags: ["vegan"],
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

describe("recipeSearchResponseSchema dietConflicts", () => {
  it("keeps the diet conflicts cache instead of stripping it", () => {
    const parsed = recipeSearchResponseSchema.parse(
      responseWith({ dietConflicts: ["meat"] }),
    );
    expect(parsed.results[0].dietConflicts).toEqual(["meat"]);
  });

  it("keeps [] (checked, none found) distinct from null", () => {
    const parsed = recipeSearchResponseSchema.parse(
      responseWith({ dietConflicts: [] }),
    );
    expect(parsed.results[0].dietConflicts).toEqual([]);
  });

  it("reads a missing, null or malformed value as unchecked, never failing the response", () => {
    for (const extra of [{}, { dietConflicts: null }, { dietConflicts: "x" }]) {
      const parsed = recipeSearchResponseSchema.safeParse(responseWith(extra));
      expect(parsed.success).toBe(true);
      expect(parsed.data?.results[0].dietConflicts).toBeNull();
    }
  });

  it("drops unknown ids", () => {
    const parsed = recipeSearchResponseSchema.parse(
      responseWith({ dietConflicts: ["future_id", "honey"] }),
    );
    expect(parsed.results[0].dietConflicts).toEqual(["honey"]);
  });
});
