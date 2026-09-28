import { describe, it, expect } from "vitest";
import {
  resolveFeaturedRecipeType,
  normalizeCatalogDetail,
} from "../featured-recipe-detail-utils";

describe("resolveFeaturedRecipeType", () => {
  it.each([
    ["catalog", undefined, "catalog"],
    ["mealPlan", undefined, "mealPlan"],
    ["community", undefined, "community"],
    [undefined, "mealPlan", "mealPlan"],
    [undefined, undefined, "community"],
    // A repeated link key arrives as an array — never a branch selector.
    [["catalog", "catalog"], undefined, "community"],
    [undefined, "catalog", "community"],
  ])("recipeType=%j type=%j → %s", (recipeType, type, expected) => {
    expect(resolveFeaturedRecipeType(recipeType, type)).toBe(expected);
  });
});

describe("normalizeCatalogDetail", () => {
  it("maps the catalog detail payload onto the detail-screen shape", () => {
    const n = normalizeCatalogDetail({
      recipe: {
        title: "Spoonacular Chili",
        description: "Warm",
        difficulty: null,
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 30,
        imageUrl: "https://img.spoonacular.com/1.jpg",
        instructions: ["Brown", "Simmer"],
        dietTags: ["gluten free"],
        caloriesPerServing: "420",
        proteinPerServing: "30",
        carbsPerServing: "40",
        fatPerServing: "12",
      },
      ingredients: [{ name: "beans", quantity: "1", unit: "can" }],
    });
    expect(n.title).toBe("Spoonacular Chili");
    expect(n.timeDisplay).toBe("10 min prep · 30 min cook");
    expect(n.nutrition).toEqual({
      calories: 420,
      protein: 30,
      carbs: 40,
      fat: 12,
    });
    expect(n.ingredients).toEqual([
      { name: "beans", quantity: "1", unit: "can" },
    ]);
  });

  it("yields null nutrition when the catalog has no calories", () => {
    const n = normalizeCatalogDetail({
      recipe: { title: "Plain", caloriesPerServing: null },
      ingredients: [],
    });
    expect(n.nutrition).toBeNull();
    expect(n.instructions).toEqual([]);
  });
});
