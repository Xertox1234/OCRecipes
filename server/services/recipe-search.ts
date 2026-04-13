import MiniSearch from "minisearch";
import type {
  SearchableRecipe,
  RecipeSearchParams,
  RecipeSearchResponse,
} from "@shared/types/recipe-search";
import type { MealPlanRecipe, CommunityRecipe } from "@shared/schema";
import { storage } from "../storage";
import { createServiceLogger } from "../lib/logger";

const log = createServiceLogger("recipe-search");

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function parseNum(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function calcTotal(prep: number | null, cook: number | null): number | null {
  if (prep === null && cook === null) return null;
  return (prep ?? 0) + (cook ?? 0);
}

// ────────────────────────────────────────────────────────────────────────────
// Normalizers (exported for testing)
// ────────────────────────────────────────────────────────────────────────────

export function mealPlanToSearchable(
  recipe: MealPlanRecipe,
  ingredientNames: string[],
): SearchableRecipe {
  const prep = recipe.prepTimeMinutes ?? null;
  const cook = recipe.cookTimeMinutes ?? null;
  return {
    id: `personal:${recipe.id}`,
    source: "personal",
    userId: recipe.userId,
    title: recipe.title,
    description: recipe.description ?? null,
    ingredients: ingredientNames,
    cuisine: recipe.cuisine ?? null,
    dietTags: recipe.dietTags ?? [],
    mealTypes: recipe.mealTypes ?? [],
    difficulty: recipe.difficulty ?? null,
    prepTimeMinutes: prep,
    cookTimeMinutes: cook,
    totalTimeMinutes: calcTotal(prep, cook),
    caloriesPerServing: parseNum(recipe.caloriesPerServing),
    proteinPerServing: parseNum(recipe.proteinPerServing),
    carbsPerServing: parseNum(recipe.carbsPerServing),
    fatPerServing: parseNum(recipe.fatPerServing),
    servings: recipe.servings ?? null,
    imageUrl: recipe.imageUrl ?? null,
    sourceUrl: recipe.sourceUrl ?? null,
    createdAt: recipe.createdAt ? recipe.createdAt.toISOString() : null,
  };
}

export function communityToSearchable(
  recipe: CommunityRecipe,
): SearchableRecipe {
  const ingredientList = recipe.ingredients ?? [];
  return {
    id: `community:${recipe.id}`,
    source: "community",
    userId: null,
    title: recipe.title,
    description: recipe.description ?? null,
    ingredients: ingredientList.map((i) => i.name),
    cuisine: null,
    dietTags: recipe.dietTags ?? [],
    mealTypes: [],
    difficulty: recipe.difficulty ?? null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: null,
    caloriesPerServing: null,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    servings: recipe.servings ?? null,
    imageUrl: recipe.imageUrl ?? null,
    sourceUrl: null,
    createdAt: recipe.createdAt ? recipe.createdAt.toISOString() : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// MiniSearch index singleton
// ────────────────────────────────────────────────────────────────────────────

let index: MiniSearch<SearchableRecipe> | null = null;
let documentStore: Map<string, SearchableRecipe> = new Map();
let initialized = false;

function createIndex(): MiniSearch<SearchableRecipe> {
  return new MiniSearch<SearchableRecipe>({
    idField: "id",
    fields: ["title", "ingredients", "description", "cuisine", "dietTags"],
    searchOptions: {
      boost: { title: 3, ingredients: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
    extractField(document, fieldName) {
      const val = (document as unknown as Record<string, unknown>)[fieldName];
      if (Array.isArray(val)) return val.join(" ");
      if (val === null || val === undefined) return "";
      return String(val);
    },
  });
}

function getIndex(): MiniSearch<SearchableRecipe> {
  if (!index) {
    index = createIndex();
  }
  return index;
}

// ────────────────────────────────────────────────────────────────────────────
// Index mutation hooks (exported)
// ────────────────────────────────────────────────────────────────────────────

export function addToIndex(doc: SearchableRecipe): void {
  if (!index) return;
  // Remove existing before re-adding (update)
  if (documentStore.has(doc.id)) {
    try {
      index.remove({ id: doc.id } as SearchableRecipe);
    } catch {
      // ignore if not in index
    }
  }
  index.add(doc);
  documentStore.set(doc.id, doc);
}

export function removeFromIndex(id: string): void {
  if (!index) return;
  if (documentStore.has(id)) {
    const doc = documentStore.get(id)!;
    try {
      index.remove(doc);
    } catch {
      // ignore
    }
    documentStore.delete(id);
  }
}

export function resetSearchIndex(): void {
  index = null;
  documentStore = new Map();
  initialized = false;
}

// ────────────────────────────────────────────────────────────────────────────
// Index initialization
// ────────────────────────────────────────────────────────────────────────────

export async function initSearchIndex(): Promise<void> {
  if (initialized) return;

  log.info("initializing recipe search index");

  const [mealPlanRecipes, communityRecipes, ingredientMap] = await Promise.all([
    storage.getAllMealPlanRecipes(),
    storage.getAllPublicCommunityRecipes(),
    storage.getAllRecipeIngredients(),
  ]);

  const idx = getIndex();
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
  initialized = true;

  log.info(
    {
      total: docs.length,
      personal: mealPlanRecipes.length,
      community: communityRecipes.length,
    },
    "recipe search index ready",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Search
// ────────────────────────────────────────────────────────────────────────────

export async function searchRecipes(
  params: RecipeSearchParams,
  userId: string,
): Promise<RecipeSearchResponse> {
  if (!initialized) {
    await initSearchIndex();
  }

  const idx = getIndex();
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

  // ── IDOR protection: personal recipes only visible to their owner ────────
  candidates = candidates.filter(
    (r) => r.source !== "personal" || r.userId === userId,
  );

  // ── Post-search filters ──────────────────────────────────────────────────
  const filters: Record<string, string | number | boolean> = {};

  if (source && source !== "all") {
    filters.source = source;
    candidates = candidates.filter((r) => r.source === source);
  }

  if (cuisine) {
    filters.cuisine = cuisine;
    const lc = cuisine.toLowerCase();
    candidates = candidates.filter(
      (r) =>
        r.cuisine?.toLowerCase() === lc ||
        r.dietTags.some((t) => t.toLowerCase() === lc),
    );
  }

  if (diet) {
    filters.diet = diet;
    const lc = diet.toLowerCase();
    candidates = candidates.filter((r) =>
      r.dietTags.some((t) => t.toLowerCase() === lc),
    );
  }

  if (mealType) {
    filters.mealType = mealType;
    const lc = mealType.toLowerCase();
    candidates = candidates.filter(
      (r) =>
        r.mealTypes.length === 0 ||
        r.mealTypes.some((m) => m.toLowerCase() === lc),
    );
  }

  if (difficulty) {
    filters.difficulty = difficulty;
    candidates = candidates.filter((r) => r.difficulty === difficulty);
  }

  if (maxPrepTime !== undefined) {
    filters.maxPrepTime = maxPrepTime;
    candidates = candidates.filter(
      (r) => r.totalTimeMinutes === null || r.totalTimeMinutes <= maxPrepTime,
    );
  }

  if (maxCalories !== undefined) {
    filters.maxCalories = maxCalories;
    candidates = candidates.filter(
      (r) =>
        r.caloriesPerServing === null || r.caloriesPerServing <= maxCalories,
    );
  }

  if (minProtein !== undefined) {
    filters.minProtein = minProtein;
    candidates = candidates.filter(
      (r) => r.proteinPerServing === null || r.proteinPerServing >= minProtein,
    );
  }

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
