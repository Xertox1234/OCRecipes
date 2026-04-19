import type {
  SearchableRecipe,
  RecipeSearchParams,
  RecipeSearchResponse,
} from "@shared/types/recipe-search";
import { storage } from "../storage";
import { createServiceLogger } from "../lib/logger";
import {
  communityToSearchable,
  getDocumentStore,
  getIndex,
  isIndexInitialized,
  markIndexInitialized,
  mealPlanToSearchable,
  resetSearchIndex as resetSearchIndexPrimitive,
} from "../lib/search-index";

// Re-export normalizers/mutations for tests and callers that imported these
// from this service historically.
export {
  addToIndex,
  communityToSearchable,
  mealPlanToSearchable,
  removeFromIndex,
} from "../lib/search-index";

const log = createServiceLogger("recipe-search");

// Shared promise guards concurrent init callers so they all await the same
// in-flight load instead of each re-running DB queries + duplicate addAll.
let initPromise: Promise<void> | null = null;

export function resetSearchIndex(): void {
  resetSearchIndexPrimitive();
  initPromise = null;
}

// ────────────────────────────────────────────────────────────────────────────
// Index initialization
// ────────────────────────────────────────────────────────────────────────────

export async function initSearchIndex(): Promise<void> {
  if (isIndexInitialized()) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    log.info("initializing recipe search index");

    try {
      const [mealPlanRecipes, communityRecipes, ingredientMap] =
        await Promise.all([
          storage.getAllMealPlanRecipes(),
          storage.getAllPublicCommunityRecipes(),
          storage.getAllRecipeIngredients(),
        ]);

      const idx = getIndex();
      const documentStore = getDocumentStore();
      const docs: SearchableRecipe[] = [];

      for (const recipe of mealPlanRecipes) {
        const ingredients = ingredientMap.get(recipe.id) ?? [];
        const doc = mealPlanToSearchable(
          recipe,
          ingredients.map((i) => i.name),
        );
        docs.push(doc);
        documentStore.set(doc.id, doc);
      }

      for (const recipe of communityRecipes) {
        const doc = communityToSearchable(recipe);
        docs.push(doc);
        documentStore.set(doc.id, doc);
      }

      idx.addAll(docs);
      markIndexInitialized();

      log.info(
        {
          total: docs.length,
          personal: mealPlanRecipes.length,
          community: communityRecipes.length,
        },
        "recipe search index ready",
      );
    } catch (err) {
      // Atomic init: if addAll (or any step) throws mid-way, clear the index
      // so the retry doesn't call addAll on documents it already partially
      // indexed (MiniSearch throws on duplicate IDs).
      resetSearchIndexPrimitive();
      throw err;
    }
  })();

  try {
    await initPromise;
  } finally {
    // Clear on both success and failure; failed init should be retryable.
    initPromise = null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Search
// ────────────────────────────────────────────────────────────────────────────

export async function searchRecipes(
  params: RecipeSearchParams,
  userId: string,
): Promise<RecipeSearchResponse> {
  if (!isIndexInitialized()) {
    await initSearchIndex();
  }

  const idx = getIndex();
  const documentStore = getDocumentStore();
  const {
    q,
    ingredients: ingredientParam,
    pantry,
    source,
    cuisine,
    diet,
    mealType,
    difficulty,
    maxPrepTime,
    maxCalories,
    minProtein,
    sort = q ? "relevance" : "newest",
    limit = 20,
    offset = 0,
  } = params;

  // ── Pantry mode: fetch user's pantry items as ingredient terms ───────────
  let pantryIngredients: string[] = [];
  if (pantry) {
    const pantryItems = await storage.getPantryItems(userId);
    pantryIngredients = pantryItems.map((item) => item.name);
  }

  // ── Resolve ingredient query terms ──────────────────────────────────────
  const ingredientTerms: string[] = pantry
    ? pantryIngredients
    : ingredientParam
      ? ingredientParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  // ── Text search ──────────────────────────────────────────────────────────
  // Store relevance scores so we can sort explicitly (not rely on Set iteration order)
  const relevanceScores = new Map<string, number>();
  let textMatchIds: Set<string> | null = null;
  if (q && q.trim()) {
    const textResults = idx.search(q.trim());
    textMatchIds = new Set<string>();
    for (const r of textResults) {
      const id = String(r.id);
      textMatchIds.add(id);
      relevanceScores.set(id, r.score);
    }
  }

  // ── Ingredient search ────────────────────────────────────────────────────
  let ingredientMatchIds: Set<string> | null = null;
  if (ingredientTerms.length > 0) {
    const ingQuery = ingredientTerms.join(" ");
    const ingResults = idx.search(ingQuery, { fields: ["ingredients"] });
    ingredientMatchIds = new Set(ingResults.map((r) => String(r.id)));
  }

  // ── Candidate pool ───────────────────────────────────────────────────────
  let candidates: SearchableRecipe[];

  if (textMatchIds !== null && ingredientMatchIds !== null) {
    // Combined: must appear in both
    const combined = [...textMatchIds].filter((id) =>
      ingredientMatchIds!.has(id),
    );
    candidates = combined.map((id) => documentStore.get(id)!).filter(Boolean);
  } else if (textMatchIds !== null) {
    candidates = [...textMatchIds]
      .map((id) => documentStore.get(id)!)
      .filter(Boolean);
  } else if (ingredientMatchIds !== null) {
    candidates = [...ingredientMatchIds]
      .map((id) => documentStore.get(id)!)
      .filter(Boolean);
  } else {
    candidates = [...documentStore.values()];
  }

  // ── Predicate composition ────────────────────────────────────────────────
  // Build a single composed predicate so we traverse `candidates` exactly once
  // (M22 audit fix: was 9 sequential `.filter()` calls allocating intermediate
  // arrays per pass — O(9·N) → O(N), critical on empty-query requests where
  // the candidate pool is the full documentStore).
  //
  // NOTE: Filter asymmetry is intentional. Numeric caps/mins (maxCalories,
  // minProtein, maxPrepTime) EXCLUDE recipes with null values — a user asking
  // for "≤400 cal" doesn't want unknown-calorie recipes mixed in. The
  // mealType filter INCLUDES recipes with an empty `mealTypes` array — legacy
  // community recipes may predate M9 classification, so excluding them here
  // would hide the entire pre-backfill community pool from every meal-type
  // search. See audit 2026-04-17 H10 + M9.
  //
  // maxPrepTime filters on `prepTimeMinutes` (not `totalTimeMinutes`) so that
  // a crockpot recipe with 10 min prep + 6h cook is correctly included by
  // maxPrepTime=15. See nutrition-accuracy-2026-04-18 M22.
  const filters: Record<string, string | number | boolean> = {};
  const predicates: ((r: SearchableRecipe) => boolean)[] = [];

  // IDOR protection: personal recipes only visible to their owner.
  predicates.push((r) => r.source !== "personal" || r.userId === userId);

  if (source && source !== "all") {
    filters.source = source;
    predicates.push((r) => r.source === source);
  }

  if (cuisine) {
    filters.cuisine = cuisine;
    const lc = cuisine.toLowerCase();
    predicates.push(
      (r) =>
        r.cuisine?.toLowerCase() === lc ||
        r.dietTags.some((t) => t.toLowerCase() === lc),
    );
  }

  if (diet) {
    filters.diet = diet;
    const lc = diet.toLowerCase();
    predicates.push((r) => r.dietTags.some((t) => t.toLowerCase() === lc));
  }

  if (mealType) {
    filters.mealType = mealType;
    const lc = mealType.toLowerCase();
    predicates.push(
      (r) =>
        r.mealTypes.length === 0 ||
        r.mealTypes.includes("unclassified") ||
        r.mealTypes.some((m) => m.toLowerCase() === lc),
    );
  }

  if (difficulty) {
    filters.difficulty = difficulty;
    predicates.push((r) => r.difficulty === difficulty);
  }

  if (maxPrepTime !== undefined) {
    filters.maxPrepTime = maxPrepTime;
    predicates.push(
      (r) => r.prepTimeMinutes !== null && r.prepTimeMinutes <= maxPrepTime,
    );
  }

  if (maxCalories !== undefined) {
    filters.maxCalories = maxCalories;
    predicates.push(
      (r) =>
        r.caloriesPerServing !== null && r.caloriesPerServing <= maxCalories,
    );
  }

  if (minProtein !== undefined) {
    filters.minProtein = minProtein;
    predicates.push(
      (r) => r.proteinPerServing !== null && r.proteinPerServing >= minProtein,
    );
  }

  // Single O(N) traversal — short-circuits on first failing predicate per doc.
  candidates = candidates.filter((r) => {
    for (const p of predicates) {
      if (!p(r)) return false;
    }
    return true;
  });

  // ── Sorting ──────────────────────────────────────────────────────────────
  if (sort === "relevance" && q) {
    // Explicit relevance sort using MiniSearch scores (not relying on Set iteration order)
    candidates.sort((a, b) => {
      const sa = relevanceScores.get(a.id) ?? 0;
      const sb = relevanceScores.get(b.id) ?? 0;
      return sb - sa;
    });
  } else if (sort === "quickest") {
    candidates.sort((a, b) => {
      const ta = a.totalTimeMinutes ?? Infinity;
      const tb = b.totalTimeMinutes ?? Infinity;
      return ta - tb;
    });
  } else if (sort === "calories_asc") {
    candidates.sort((a, b) => {
      const ca = a.caloriesPerServing ?? Infinity;
      const cb = b.caloriesPerServing ?? Infinity;
      return ca - cb;
    });
  } else {
    // newest, popular (until we have popularity metrics), or relevance without q
    candidates.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  }

  // ── Pagination ───────────────────────────────────────────────────────────
  const total = candidates.length;
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const page = candidates.slice(safeOffset, safeOffset + safeLimit);

  return {
    results: page,
    total,
    offset: safeOffset,
    limit: safeLimit,
    query: {
      q: q ?? null,
      filters,
      sort,
    },
  };
}
