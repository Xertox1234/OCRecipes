/**
 * Pure merge and filter for the wizard's Recipes step: one list built from
 * the user's favourites and their own recipes. No React imports here.
 */
import type { MealPlanRecipe, ResolvedFavouriteRecipe } from "@shared/schema";
import { recipeKey, type WizardRecipe } from "./cookbook-wizard-utils";

export type RecipeFilter = "all" | "favourites" | "mine";

export type SourcedRecipe = WizardRecipe & {
  isFavourite: boolean;
  isMine: boolean;
};

/**
 * Favourites first, then the user's own recipes, each recipe once. A recipe
 * is "mine" only when it comes back in `personal` — a favourited meal-plan
 * recipe may be someone else's.
 */
export function mergeRecipeSources(
  favourites: Pick<
    ResolvedFavouriteRecipe,
    "recipeId" | "recipeType" | "title" | "imageUrl"
  >[],
  personal: Pick<MealPlanRecipe, "id" | "title" | "imageUrl">[],
): SourcedRecipe[] {
  const byKey = new Map<string, SourcedRecipe>();

  for (const f of favourites) {
    const recipe: SourcedRecipe = {
      recipeId: f.recipeId,
      recipeType: f.recipeType,
      title: f.title,
      imageUrl: f.imageUrl,
      isFavourite: true,
      isMine: false,
    };
    const key = recipeKey(recipe);
    if (!byKey.has(key)) byKey.set(key, recipe);
  }

  for (const p of personal) {
    const key = recipeKey({ recipeId: p.id, recipeType: "mealPlan" });
    const existing = byKey.get(key);
    if (existing) {
      existing.isMine = true;
      continue;
    }
    byKey.set(key, {
      recipeId: p.id,
      recipeType: "mealPlan",
      title: p.title,
      imageUrl: p.imageUrl,
      isFavourite: false,
      isMine: true,
    });
  }

  return [...byKey.values()];
}

/** Keeps the filter's recipes whose title contains the trimmed query. */
export function filterRecipes<T extends SourcedRecipe>(
  list: T[],
  filter: RecipeFilter,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  return list.filter((r) => {
    if (filter === "favourites" && !r.isFavourite) return false;
    if (filter === "mine" && !r.isMine) return false;
    return needle === "" || r.title.toLowerCase().includes(needle);
  });
}
