import { describe, it, expect } from "vitest";
import {
  resolveFeaturedRecipeType,
  freshRecipePhotoPollInterval,
  FRESH_PHOTO_POLL_MS,
  FRESH_PHOTO_WINDOW_MS,
} from "../featured-recipe-detail-utils";

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

describe("freshRecipePhotoPollInterval", () => {
  const now = Date.parse("2026-10-14T20:49:20.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("re-checks a just-made recipe whose photo is still being generated", () => {
    expect(
      freshRecipePhotoPollInterval(
        { imageUrl: null, createdAt: ago(1000) },
        now,
      ),
    ).toBe(FRESH_PHOTO_POLL_MS);
  });
  it("stops once the photo is there", () => {
    expect(
      freshRecipePhotoPollInterval(
        { imageUrl: "https://img/x.jpg", createdAt: ago(1000) },
        now,
      ),
    ).toBe(false);
  });
  it("never polls an old recipe that simply has no photo", () => {
    expect(
      freshRecipePhotoPollInterval(
        { imageUrl: null, createdAt: ago(FRESH_PHOTO_WINDOW_MS + 1) },
        now,
      ),
    ).toBe(false);
  });
  it("does not poll before the recipe has loaded, or with a bad date", () => {
    expect(freshRecipePhotoPollInterval(undefined, now)).toBe(false);
    expect(
      freshRecipePhotoPollInterval({ imageUrl: null, createdAt: "nope" }, now),
    ).toBe(false);
  });
});
