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

export const FRESH_PHOTO_POLL_MS = 3000;
export const FRESH_PHOTO_WINDOW_MS = 2 * 60 * 1000;

/**
 * A just-made recipe (generated, or "Make this mine") opens before its photo
 * exists: the server adds the photo in the background, 5-30 s later. Re-check
 * while the recipe is that fresh and still photo-less; an older recipe without
 * a photo never polls.
 */
export function freshRecipePhotoPollInterval(
  recipe: { imageUrl: string | null; createdAt: string | Date } | undefined,
  now: number,
): number | false {
  if (!recipe || recipe.imageUrl) return false;
  const created = new Date(recipe.createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return now - created < FRESH_PHOTO_WINDOW_MS ? FRESH_PHOTO_POLL_MS : false;
}
