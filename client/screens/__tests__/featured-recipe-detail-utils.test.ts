import { describe, it, expect } from "vitest";
import {
  resolveFeaturedRecipeType,
  normalizeCatalogDetail,
  catalogSaveErrorMessage,
} from "../featured-recipe-detail-utils";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

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

describe("catalogSaveErrorMessage", () => {
  it.each([
    [
      "network failure",
      new TypeError("Network request failed"),
      { message: "Couldn't save this recipe. Try again.", retryable: true },
    ],
    [
      "500",
      new ApiError("500", ErrorCode.INTERNAL_ERROR, 500),
      { message: "Couldn't save this recipe. Try again.", retryable: true },
    ],
    [
      "402 quota",
      new ApiError("402", ErrorCode.CATALOG_QUOTA_EXCEEDED, 402),
      {
        message: "Spoonacular isn't available right now. Try again later.",
        retryable: false,
      },
    ],
    [
      "404 gone",
      new ApiError("404", ErrorCode.NOT_FOUND, 404),
      { message: "This recipe is no longer available.", retryable: false },
    ],
    [
      "422 quality gate",
      new ApiError("422", ErrorCode.VALIDATION_ERROR, 422),
      {
        message:
          "This recipe has no ingredients or steps, so it can't be saved.",
        retryable: false,
      },
    ],
  ])("%s", (_label, err, expected) => {
    expect(catalogSaveErrorMessage(err)).toEqual(expected);
  });
});
