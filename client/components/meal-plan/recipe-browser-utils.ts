import type { SearchFilters } from "@/components/meal-plan/SearchFilterSheet";
import type { SearchableRecipe } from "@shared/types/recipe-search";

/**
 * Consolidated RecipeBrowserScreen filter state: the chip-row toggles
 * (cuisine/diet/difficulty/curated/safe-for-me/pantry) plus the advanced
 * filter sheet's own fields, nested under `advanced` so SearchFilterSheet's
 * `SearchFilters` contract is untouched and a sheet reset can never clear
 * the chip row.
 */
export interface RecipeFilters {
  activeCuisine: string | undefined;
  activeDiet: string | undefined;
  activeDifficulty: string | undefined;
  curatedOnly: boolean;
  safeForMe: boolean;
  pantryMode: boolean;
  advanced: SearchFilters;
}

/** Single source of truth for the filters default — used at init, on
 *  "Clear Filters", and (via `DEFAULT_FILTERS.advanced`) on the advanced
 *  filter sheet's own reset. */
export const DEFAULT_FILTERS: RecipeFilters = {
  activeCuisine: undefined,
  activeDiet: undefined,
  activeDifficulty: undefined,
  curatedOnly: false,
  safeForMe: false,
  pantryMode: false,
  advanced: {
    sort: "relevance",
    maxPrepTime: undefined,
    maxCalories: undefined,
    minProtein: undefined,
    source: "all",
  },
};

/**
 * Active-filter badge count shown on the filter icon. Matches the screen's
 * pre-existing behavior: only the advanced sheet's own fields plus
 * curatedOnly/safeForMe count — the chip-row cuisine/diet/difficulty/pantry
 * toggles are tracked separately (see isBlankBrowseState) and deliberately
 * do not contribute to this badge.
 */
export function computeActiveFilterCount(filters: RecipeFilters): number {
  let count = 0;
  if (filters.advanced.sort !== "relevance") count++;
  if (filters.advanced.maxPrepTime !== undefined) count++;
  if (filters.advanced.maxCalories !== undefined) count++;
  if (filters.advanced.minProtein !== undefined) count++;
  if (filters.advanced.source !== "all") count++;
  if (filters.curatedOnly) count++;
  if (filters.safeForMe) count++;
  return count;
}

export type IdeasCtaState = "idle" | "locked" | "loading" | "error" | "hidden";

/** Selects how the "Ideas for you" CTA under the search results presents,
 *  given the user's tier and the idea-listing request's progress. Pure —
 *  unit-tested without rendering. Once cards are showing the CTA steps aside. */
export function resolveIdeasCtaState(args: {
  isPremium: boolean;
  pending: boolean;
  error: { status?: number } | null;
  hasIdeas: boolean;
}): IdeasCtaState {
  if (!args.isPremium) return "locked";
  if (args.pending) return "loading";
  if (args.hasIdeas) return "hidden";
  if (args.error) return "error";
  return "idle";
}

/** Detail-screen params for a search row. */
export function detailParamsForSearchResult(
  item: Pick<SearchableRecipe, "id" | "source">,
): { recipeId: number; recipeType: "community" | "mealPlan" } {
  const recipeId = parseInt(item.id.split(":")[1], 10);
  if (item.source === "personal") return { recipeId, recipeType: "mealPlan" };
  return { recipeId, recipeType: "community" };
}
