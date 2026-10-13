import { describe, it, expect } from "vitest";
import { resolveFeaturedRecipeType } from "../featured-recipe-detail-utils";

describe("resolveFeaturedRecipeType", () => {
  it.each([
    // Catalog previews are gone; an old "catalog" param opens as community.
    ["catalog", undefined, "community"],
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
