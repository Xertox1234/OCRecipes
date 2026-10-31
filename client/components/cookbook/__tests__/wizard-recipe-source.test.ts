import { describe, it, expect } from "vitest";

import { filterRecipes, mergeRecipeSources } from "../wizard-recipe-source";

const favourites = [
  {
    recipeId: 7,
    recipeType: "community" as const,
    title: "Garlic Lemon Chicken",
    imageUrl: "https://cdn.example/chicken.jpg",
  },
  {
    recipeId: 3,
    recipeType: "mealPlan" as const,
    title: "Smoky Lentil Stew",
    imageUrl: null,
  },
];

const personal = [
  { id: 3, title: "Smoky Lentil Stew", imageUrl: null },
  { id: 9, title: "Lentil Shepherd's Pie", imageUrl: "/uploads/pie.jpg" },
  { id: 11, title: "Sunday Ragù", imageUrl: null },
];

describe("mergeRecipeSources", () => {
  it("lists a recipe that is in both sources once, flagged as both", () => {
    const merged = mergeRecipeSources(favourites, personal);
    const stews = merged.filter(
      (r) => r.recipeType === "mealPlan" && r.recipeId === 3,
    );
    expect(stews).toHaveLength(1);
    expect(stews[0]).toMatchObject({ isFavourite: true, isMine: true });
    expect(merged).toHaveLength(4);
  });

  it("puts favourites first, then the user's own recipes", () => {
    const merged = mergeRecipeSources(favourites, personal);
    expect(merged.map((r) => r.title)).toEqual([
      "Garlic Lemon Chicken",
      "Smoky Lentil Stew",
      "Lentil Shepherd's Pie",
      "Sunday Ragù",
    ]);
  });

  it("does not call a favourited community recipe the user's own", () => {
    const merged = mergeRecipeSources(favourites, personal);
    expect(merged[0]).toMatchObject({
      recipeId: 7,
      recipeType: "community",
      isFavourite: true,
      isMine: false,
    });
    expect(merged[2]).toMatchObject({
      recipeId: 9,
      recipeType: "mealPlan",
      isFavourite: false,
      isMine: true,
      imageUrl: "/uploads/pie.jpg",
    });
  });
});

describe("filterRecipes", () => {
  const merged = mergeRecipeSources(favourites, personal);

  it("'mine' with a padded, mixed-case query returns only the matching personal recipes", () => {
    const result = filterRecipes(merged, "mine", " lentil ");
    expect(result.map((r) => r.title)).toEqual([
      "Smoky Lentil Stew",
      "Lentil Shepherd's Pie",
    ]);
    expect(
      filterRecipes(merged, "mine", " PIE ").map((r) => r.recipeId),
    ).toEqual([9]);
  });

  it("'favourites' keeps only favourites", () => {
    expect(
      filterRecipes(merged, "favourites", "").map((r) => r.recipeId),
    ).toEqual([7, 3]);
  });

  it("'all' with a blank query returns everything", () => {
    expect(filterRecipes(merged, "all", "   ")).toHaveLength(4);
  });

  it("returns nothing when no title matches", () => {
    expect(filterRecipes(merged, "all", "tofu")).toEqual([]);
  });
});
