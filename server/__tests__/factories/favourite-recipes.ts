import type { FavouriteRecipe, ResolvedFavouriteRecipe } from "@shared/schema";

const favouriteRecipeDefaults: FavouriteRecipe = {
  id: 1,
  userId: "1",
  recipeId: 1,
  recipeType: "mealPlan",
  createdAt: new Date("2024-01-01"),
};

export function createMockFavouriteRecipe(
  overrides: Partial<FavouriteRecipe> = {},
): FavouriteRecipe {
  return { ...favouriteRecipeDefaults, ...overrides };
}

const resolvedFavouriteRecipeDefaults: ResolvedFavouriteRecipe = {
  recipeId: 1,
  recipeType: "mealPlan",
  title: "Test Recipe",
  description: null,
  imageUrl: null,
  servings: 2,
  difficulty: null,
  favouritedAt: new Date("2024-01-01").toISOString(),
};

export function createMockResolvedFavouriteRecipe(
  overrides: Partial<ResolvedFavouriteRecipe> = {},
): ResolvedFavouriteRecipe {
  return { ...resolvedFavouriteRecipeDefaults, ...overrides };
}
