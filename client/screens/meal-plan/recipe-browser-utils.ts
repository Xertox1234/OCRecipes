import { ApiError } from "@/lib/api-error";
import type { SearchFilters } from "@/components/meal-plan/SearchFilterSheet";

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

/**
 * Decides whether selecting a new source filter should be blocked behind the
 * premium upgrade prompt. The "Online" (Spoonacular) source is premium-only —
 * free users must upgrade before they can search the online catalog. All other
 * sources (all / personal / community) are free.
 */
export function shouldGatePremiumSource(
  nextSource: SearchFilters["source"],
  isPremium: boolean,
): boolean {
  return nextSource === "spoonacular" && !isPremium;
}

/**
 * Detects the catalog endpoint's quota-exhausted response. The catalog search
 * route returns HTTP 402 with `code: "CATALOG_QUOTA_EXCEEDED"` when the
 * Spoonacular API quota is spent; `apiRequest` surfaces it as an `ApiError`
 * carrying that machine-readable code.
 *
 * Callers must still gate this on the active source being "Online" — a stale
 * quota error from a prior catalog search should not surface once the user
 * switches back to a local source.
 */
export function isQuotaExceededError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "CATALOG_QUOTA_EXCEEDED";
}

export type OnlineCtaState =
  | "hidden"
  | "premium-locked"
  | "actionable"
  | "loading"
  | "quota-exhausted";

/** Selects how the inline "Search online" CTA presents, given catalog
 *  availability, the user's tier, and the online request's progress. Pure —
 *  unit-tested without rendering. quota-exhausted/loading apply only after the
 *  premium user has actually requested the online search. */
export function resolveOnlineCtaState(a: {
  catalogDisabled: boolean;
  isPremium: boolean;
  hasQuery: boolean;
  onlineRequested: boolean;
  onlineLoading: boolean;
  quotaExhausted: boolean;
}): OnlineCtaState {
  if (a.catalogDisabled || !a.hasQuery) return "hidden";
  if (!a.isPremium) return "premium-locked";
  if (a.onlineRequested && a.quotaExhausted) return "quota-exhausted";
  if (a.onlineRequested && a.onlineLoading) return "loading";
  return "actionable";
}
