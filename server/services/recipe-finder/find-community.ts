// server/services/recipe-finder/find-community.ts
import type {
  RecipeSearchParams,
  SearchableRecipe,
} from "@shared/types/recipe-search";
import {
  FINDER_MAX_ITEMS,
  type FinderItem,
  type RecipeQuery,
} from "@shared/schemas/recipe-finder";
import { searchRecipes, initSearchIndex } from "../recipe-search";
import { isIndexInitialized } from "../../lib/search-index";
import { fireAndForget } from "../../lib/fire-and-forget";
import { createServiceLogger, toError } from "../../lib/logger";

const log = createServiceLogger("recipe-finder-community");

/**
 * Keep hits scoring at least this fraction of the best hit. Relative because
 * MiniSearch scores are unnormalized and an absolute cut drifts as the
 * catalog grows (spec §4). MEASURED in Task 10 — see the gold set.
 */
export const CLOSE_MATCH_RELATIVE = 0.5;
/** Absolute floor so a lone weak hit is not shown. MEASURED in Task 10. */
export const CLOSE_MATCH_FLOOR = 5;

export interface ScoredHit {
  recipe: SearchableRecipe;
  score: number;
}

export function selectCloseMatches(
  hits: ScoredHit[],
  opts: { relative: number; floor: number; max: number } = {
    relative: CLOSE_MATCH_RELATIVE,
    floor: CLOSE_MATCH_FLOOR,
    max: FINDER_MAX_ITEMS,
  },
): ScoredHit[] {
  if (hits.length === 0) return [];
  const best = Math.max(...hits.map((h) => h.score));
  const cutoff = Math.max(opts.floor, best * opts.relative);
  return hits
    .filter((h) => h.score >= cutoff)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.max);
}

/** R3: community rows always have cuisine null, so cuisine goes into q. */
export function communityQueryText(query: RecipeQuery): string {
  return [query.cuisine, query.q].filter(Boolean).join(" ");
}

export function toFinderItem(r: SearchableRecipe): FinderItem | null {
  const id = parseInt(r.id.split(":")[1] ?? "", 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    source: "community",
    title: r.title.slice(0, 200),
    imageUrl: r.imageUrl,
    readyInMinutes:
      r.totalTimeMinutes !== null && r.totalTimeMinutes > 0
        ? Math.round(r.totalTimeMinutes)
        : null,
    calories:
      r.caloriesPerServing !== null && r.caloriesPerServing >= 0
        ? Math.round(r.caloriesPerServing)
        : null,
  };
}

export async function findCommunity(
  query: RecipeQuery,
  userId: string,
  excludeIds: string[],
  thresholds: { relative: number; floor: number } = {
    relative: CLOSE_MATCH_RELATIVE,
    floor: CLOSE_MATCH_FLOOR,
  },
): Promise<FinderItem[]> {
  // §6: an index still building at boot is 0 matches, not a wait.
  if (!isIndexInitialized()) {
    fireAndForget("recipe-finder-index-init", initSearchIndex());
    return [];
  }
  const q = communityQueryText(query);
  const exclude = new Set(excludeIds);

  const run = async (
    filters: Pick<RecipeSearchParams, "diet" | "mealType">,
  ): Promise<ScoredHit[]> => {
    // Never maxPrepTime (every community row has null prep time — R3) and
    // never the cuisine filter (it is already in q).
    const res = await searchRecipes(
      {
        ...filters,
        q,
        source: "community",
        safeForMe: true,
        sort: "relevance",
        limit: 25,
      },
      userId,
      { includeScores: true },
    );
    return res.results
      .filter((r) => !exclude.has(r.id))
      .map((r) => ({ recipe: r, score: res.scores?.[r.id] ?? 0 }));
  };

  try {
    const filters: Pick<RecipeSearchParams, "diet" | "mealType"> = {};
    if (query.diet) filters.diet = query.diet;
    if (query.mealType) filters.mealType = query.mealType;
    let hits = await run(filters);
    // A small catalog + a structured filter often zeroes out: retry q-only.
    if (hits.length === 0 && Object.keys(filters).length > 0) {
      hits = await run({});
    }
    return selectCloseMatches(hits, { ...thresholds, max: FINDER_MAX_ITEMS })
      .map((h) => toFinderItem(h.recipe))
      .filter((i): i is FinderItem => i !== null);
  } catch (error) {
    log.warn(
      { err: toError(error) },
      "findCommunity failed; treating as 0 matches",
    );
    return [];
  }
}
