import { storage } from "../storage";
import { inferMealTypes } from "../lib/meal-type-inference";

// Re-export the pure inference primitive for backwards compatibility with
// existing callers (routes) that imported from this service path.
export { inferMealTypes };

/**
 * Backfill `mealTypes` for meal-plan recipes with empty/null classification.
 *
 * Pairs with `backfillCommunityMealTypes` in `server/scripts/backfill-community-meal-types.ts`
 * which covers the community_recipes table.
 */
export async function backfillMealTypes(): Promise<number> {
  const { recipes, ingredientsByRecipe } =
    await storage.getRecipesWithEmptyMealTypes();

  if (recipes.length === 0) return 0;

  const updates = recipes.map((recipe) => {
    const ingredientNames = ingredientsByRecipe.get(recipe.id);
    const mealTypes = inferMealTypes(recipe.title, ingredientNames);
    return { id: recipe.id, mealTypes };
  });

  return storage.batchUpdateMealTypes(updates);
}
