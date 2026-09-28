// server/services/recipe-finder/find-online.ts
import {
  FINDER_MAX_ITEMS,
  type FinderItem,
  type RecipeQuery,
} from "@shared/schemas/recipe-finder";
import {
  searchCatalogRecipes,
  buildIntolerancesParam,
  CatalogQuotaError,
} from "../recipe-catalog";
import { isOnlineCatalogConfigured } from "./config";
import { createServiceLogger, toError } from "../../lib/logger";

const log = createServiceLogger("recipe-finder-online");

export type FindOnlineResult =
  | { status: "ok"; items: FinderItem[] }
  | { status: "unavailable" };

// Spoonacular's `type` vocabulary (complexSearch).
const SPOONACULAR_MEAL_TYPE: Record<
  NonNullable<RecipeQuery["mealType"]>,
  string
> = {
  breakfast: "breakfast",
  lunch: "main course",
  dinner: "main course",
  snack: "snack",
};

/**
 * List search only — no addRecipeNutrition (~1 quota point per search;
 * nutrition is fetched only when a preview opens). Any failure is
 * "unavailable", never "no results" (§6).
 */
export async function findOnline(
  query: RecipeQuery,
  allergies: unknown,
): Promise<FindOnlineResult> {
  if (!isOnlineCatalogConfigured()) return { status: "unavailable" };
  const intolerances = buildIntolerancesParam(allergies);
  try {
    const res = await searchCatalogRecipes(
      {
        query: query.q,
        number: FINDER_MAX_ITEMS,
        ...(query.cuisine && { cuisine: query.cuisine }),
        ...(query.diet && { diet: query.diet }),
        ...(query.mealType && { type: SPOONACULAR_MEAL_TYPE[query.mealType] }),
        ...(query.maxPrepTime && { maxReadyTime: query.maxPrepTime }),
        ...(intolerances && { intolerances }),
      },
      { strict: true },
    );
    const items: FinderItem[] = res.results
      .filter((r) => Number.isInteger(r.id) && r.id > 0)
      .slice(0, FINDER_MAX_ITEMS)
      .map((r) => ({
        id: r.id,
        source: "spoonacular",
        title: r.title.slice(0, 200),
        imageUrl: r.image ?? null,
        readyInMinutes:
          r.readyInMinutes !== undefined && r.readyInMinutes > 0
            ? Math.round(r.readyInMinutes)
            : null,
        calories: null,
      }));
    return { status: "ok", items };
  } catch (error) {
    log.warn(
      { err: toError(error), quota: error instanceof CatalogQuotaError },
      "findOnline failed; reporting unavailable",
    );
    return { status: "unavailable" };
  }
}
