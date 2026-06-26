import { ApiError } from "@/lib/api-error";
import type { SearchFilters } from "@/components/meal-plan/SearchFilterSheet";

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
