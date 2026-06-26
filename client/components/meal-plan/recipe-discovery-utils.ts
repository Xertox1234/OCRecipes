import type { SearchableRecipe } from "@shared/types/recipe-search";
import type { CarouselRecipeCard } from "@shared/types/carousel";

/** "community:17" -> 17. The source prefix is dropped; callers that need to
 *  navigate must keep the original SearchableRecipe (the numeric id is lossy
 *  — personal:17 and community:17 both yield 17). */
export function parseSearchableRecipeNumericId(id: string): number {
  return Number.parseInt(id.split(":")[1] ?? "", 10);
}

/** Adapt a local SearchableRecipe into the reusable CarouselRecipeCard shape.
 *  recommendationReason carries a compact meta string (calories → time → cuisine). */
export function toCarouselCard(recipe: SearchableRecipe): CarouselRecipeCard {
  const reason =
    recipe.caloriesPerServing != null
      ? `${recipe.caloriesPerServing} cal`
      : recipe.totalTimeMinutes != null
        ? `${recipe.totalTimeMinutes} min`
        : (recipe.cuisine ?? "");
  return {
    id: parseSearchableRecipeNumericId(recipe.id),
    title: recipe.title,
    imageUrl: recipe.imageUrl,
    prepTimeMinutes: recipe.totalTimeMinutes ?? recipe.prepTimeMinutes,
    recommendationReason: reason,
    isCanonical: recipe.isCanonical,
  };
}
