import type {
  SearchableRecipe,
  RecipeSearchParams,
} from "@shared/types/recipe-search";
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

/** Cache discovery rows for 5 min so remounting the screen doesn't refetch and
 *  starve the 20/min `/api/recipes/search` budget. */
export const DISCOVERY_STALE_TIME_MS = 5 * 60_000;

const ROW_LIMIT = 10;

/** Local-only preset rows for the Discover feed. `pantry` is premiumOnly
 *  because `pantryTracking` is a premium feature — the feed hides it for free
 *  users (editorial rows carry their feed). */
export const DISCOVERY_PRESETS: {
  key: "pantry" | "quick" | "featured";
  title: string;
  premiumOnly: boolean;
  params: RecipeSearchParams;
}[] = [
  {
    key: "pantry",
    title: "From your pantry",
    premiumOnly: true,
    params: { pantry: true, limit: ROW_LIMIT },
  },
  {
    key: "quick",
    title: "Quick & Easy",
    premiumOnly: false,
    params: { maxPrepTime: 20, sort: "quickest", limit: ROW_LIMIT },
  },
  {
    key: "featured",
    title: "Featured",
    premiumOnly: false,
    params: { curatedOnly: true, limit: ROW_LIMIT },
  },
];
