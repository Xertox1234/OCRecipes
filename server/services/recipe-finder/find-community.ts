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
 * catalog grows (spec §4). Measured 2026-09-28 on the 25-recipe production
 * public catalog: 22/30 gold requests correct at (0.7, 8) vs 20/30 at the
 * provisional (0.5, 5) — see __tests__/fixtures/finder-gold-set.json.
 * Re-measured after community diet tags + filter-only browsing: 25/30, still
 * the best row (tied with 0.8). Re-measure as the catalog grows.
 */
export const CLOSE_MATCH_RELATIVE = 0.7;
/** Absolute floor so a lone weak hit is not shown. Measured with the above. */
export const CLOSE_MATCH_FLOOR = 8;

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

/** extractQuery speaks Spoonacular's diet words; community tags differ. */
const COMMUNITY_DIET_ALIASES: Record<string, string> = {
  ketogenic: "keto",
  pescetarian: "pescatarian",
};

/** "gluten free" → "gluten-free", "ketogenic" → "keto" (community side only). */
export function communityDietTag(diet: string): string {
  const tag = diet.trim().toLowerCase().replace(/\s+/g, "-");
  return COMMUNITY_DIET_ALIASES[tag] ?? tag;
}

const BROWSE_FILLER = new Set([
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "supper",
  "snack",
  "snacks",
  "meal",
  "meals",
  "recipe",
  "recipes",
  "food",
  "dish",
  "dishes",
  "something",
  "idea",
  "ideas",
  "option",
  "options",
]);

/**
 * "keto dinner" → q "dinner": the text says nothing the diet and meal-type
 * filters don't, and matches almost no recipe text. Such a request browses
 * the filters instead (measured on the gold set, 2026-09-28).
 */
export function isFilterOnlyRequest(query: RecipeQuery): boolean {
  if (!query.diet) return false;
  const dietWords = new Set(
    [query.diet, communityDietTag(query.diet)]
      .join(" ")
      .toLowerCase()
      .split(/[\s-]+/),
  );
  return communityQueryText(query)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .every((w) => BROWSE_FILLER.has(w) || dietWords.has(w));
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
  const browse = isFilterOnlyRequest(query);
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
        ...(!browse && { q }),
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
    const diet = query.diet ? communityDietTag(query.diet) : undefined;
    let hits = await run({
      ...(diet && { diet }),
      ...(query.mealType && { mealType: query.mealType }),
    });
    // A small catalog + a meal-type filter often zeroes out: retry without
    // it. A stated diet is never dropped — no diet-safe hit is no matches.
    if (hits.length === 0 && query.mealType) {
      hits = await run(diet ? { diet } : {});
    }
    // Browse hits carry no text score (all 0): every filter hit is a match.
    const selected = browse
      ? hits.slice(0, FINDER_MAX_ITEMS)
      : selectCloseMatches(hits, { ...thresholds, max: FINDER_MAX_ITEMS });
    return selected
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
