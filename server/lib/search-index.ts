/**
 * Recipe search index — cross-cutting module owning the MiniSearch singleton
 * and its mutation primitives. Both `server/storage/` (writers) and
 * `server/services/recipe-search.ts` (readers + init) depend on this module,
 * preserving the `routes → services → storage` dependency direction and
 * satisfying the Storage Layer Purity pattern.
 */
import MiniSearch from "minisearch";
import type { SearchableRecipe } from "@shared/types/recipe-search";
import type { MealPlanRecipe, CommunityRecipe } from "@shared/schema";

/**
 * Columns needed to hydrate a meal-plan search-index entry. Omits heavy JSONB
 * columns (`instructions`) that the index never reads.
 */
export type SearchIndexableMealPlanRecipe = Pick<
  MealPlanRecipe,
  | "id"
  | "userId"
  | "title"
  | "description"
  | "cuisine"
  | "dietTags"
  | "mealTypes"
  | "difficulty"
  | "prepTimeMinutes"
  | "cookTimeMinutes"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
  | "servings"
  | "imageUrl"
  | "sourceUrl"
  | "createdAt"
>;

/**
 * Columns needed to hydrate a community search-index entry. Omits heavy JSONB
 * columns (`instructions`) that the index never reads.
 */
export type SearchIndexableCommunityRecipe = Pick<
  CommunityRecipe,
  | "id"
  | "title"
  | "description"
  | "ingredients"
  | "dietTags"
  | "mealTypes"
  | "difficulty"
  | "servings"
  | "imageUrl"
  | "createdAt"
>;

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
// Normalizers
// ────────────────────────────────────────────────────────────────────────────

export function mealPlanToSearchable(
  recipe: MealPlanRecipe | SearchIndexableMealPlanRecipe,
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
  recipe: CommunityRecipe | SearchIndexableCommunityRecipe,
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
    mealTypes: recipe.mealTypes ?? [],
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

export function getIndex(): MiniSearch<SearchableRecipe> {
  if (!index) {
    index = createIndex();
  }
  return index;
}

export function getDocumentStore(): Map<string, SearchableRecipe> {
  return documentStore;
}

export function isIndexInitialized(): boolean {
  return initialized;
}

export function markIndexInitialized(): void {
  initialized = true;
}

// ────────────────────────────────────────────────────────────────────────────
// Mutation primitives — called by storage after writes commit
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
