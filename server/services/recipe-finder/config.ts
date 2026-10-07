// server/services/recipe-finder/config.ts
// Read at call time, never at module load: Railway variable flips and tests
// both change process.env after import.

/** Spec §8: the whole finder sits behind this flag, off by default. */
export function isRecipeFinderEnabled(): boolean {
  return process.env.RECIPE_FINDER_ENABLED === "true";
}

/** Spec 2026-10-06 §8: offer + adjust card; requires the finder. */
export function isRecipeOfferEnabled(): boolean {
  return isRecipeFinderEnabled() && process.env.RECIPE_OFFER_ENABLED === "true";
}

/** D9: per-user Spoonacular list searches per day. */
export const DEFAULT_SPOONACULAR_DAILY_CAP = 10;

export function getSpoonacularDailyCap(): number {
  const raw = process.env.RECIPE_FINDER_SPOONACULAR_DAILY_CAP;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_SPOONACULAR_DAILY_CAP;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_SPOONACULAR_DAILY_CAP;
}

/** Same check as GET /api/meal-plan/catalog/config (§6: hide the button). */
export function isOnlineCatalogConfigured(): boolean {
  return Boolean(process.env.SPOONACULAR_API_KEY);
}
