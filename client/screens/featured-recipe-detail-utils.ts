export type FeaturedRecipeType = "community" | "mealPlan";

/**
 * Route params are typed, but a link's repeated query key arrives as an
 * array (linking.ts's `parse` skips non-strings) — only an exact string may
 * select a branch. Anything else, including a stale "catalog" from before
 * catalog previews were removed, opens as community.
 */
export function resolveFeaturedRecipeType(
  recipeType: unknown,
  type: unknown,
): FeaturedRecipeType {
  if (recipeType === "mealPlan" || recipeType === "community") {
    return recipeType;
  }
  if (type === "mealPlan") return "mealPlan";
  return "community";
}
