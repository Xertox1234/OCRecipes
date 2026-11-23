# Recipe Search Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace basic ILIKE substring search with a MiniSearch-powered unified search across personal, community, and Spoonacular recipes — with fuzzy text search, ingredient search, pantry-aware filtering, and rich filter/sort options.

**Architecture:** Server-side MiniSearch index holds normalized `SearchableRecipe` documents from all three sources. A single `GET /api/recipes/search` endpoint queries the index with text search + post-search filters. The client's `RecipeBrowserScreen` is updated to use the new endpoint with expanded filter UI and an advanced filters bottom sheet.

**Tech Stack:** MiniSearch (server), @gorhom/bottom-sheet v5 (client filter sheet), @react-native-community/slider (client range inputs), TanStack Query v5 (client data fetching), Zod (input validation), Vitest (testing)

---

## File Structure

### New Files

| File                                                               | Responsibility                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `shared/types/recipe-search.ts`                                    | `SearchableRecipe`, `RecipeSearchParams`, `RecipeSearchResponse` types shared between client and server |
| `server/services/recipe-search.ts`                                 | MiniSearch index lifecycle, search execution, Spoonacular merging, index hooks                          |
| `server/services/__tests__/recipe-search.test.ts`                  | Unit tests for search service                                                                           |
| `client/hooks/useRecipeSearch.ts`                                  | TanStack Query hook for `/api/recipes/search` endpoint                                                  |
| `client/hooks/__tests__/useRecipeSearch.test.ts`                   | Hook tests                                                                                              |
| `client/components/meal-plan/SearchFilterSheet.tsx`                | Advanced filters bottom sheet                                                                           |
| `client/components/meal-plan/__tests__/SearchFilterSheet.test.tsx` | Filter sheet tests                                                                                      |

### Modified Files

| File                                               | Changes                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `server/routes/recipes.ts`                         | Add `GET /api/recipes/search` endpoint; old `/browse` delegates to search service                     |
| `server/routes/__tests__/recipes.test.ts`          | Add tests for new search endpoint                                                                     |
| `server/storage/meal-plans.ts`                     | Add `getAllMealPlanRecipes()` and `getAllRecipeIngredients()` for index init                          |
| `server/storage/community.ts`                      | Add `getAllPublicCommunityRecipes()` for index init                                                   |
| `server/storage/index.ts`                          | Wire new storage functions                                                                            |
| `client/screens/meal-plan/RecipeBrowserScreen.tsx` | Replace `useUnifiedRecipes` with `useRecipeSearch`, add filter sheet, ingredient chips, source badges |
| `client/hooks/useMealPlanRecipes.ts`               | Keep for non-search uses (detail, create, save); search usage migrated                                |
| `package.json`                                     | Add `minisearch`, `@react-native-community/slider`                                                    |

---

### Task 1: Install dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install MiniSearch and Slider**

```bash
npm install minisearch @react-native-community/slider
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('minisearch')" && echo "minisearch OK"
```

Expected: "minisearch OK"

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add minisearch and slider dependencies"
```

---

### Task 2: Define shared types

**Files:**

- Create: `shared/types/recipe-search.ts`

- [ ] **Step 1: Create the shared types file**

```ts
// shared/types/recipe-search.ts

export interface SearchableRecipe {
  id: string; // "personal:42", "community:17", "spoonacular:654321"
  source: "personal" | "community" | "spoonacular";
  title: string;
  description: string | null;
  ingredients: string[]; // flattened ingredient names for search
  cuisine: string | null;
  dietTags: string[];
  mealTypes: string[];
  difficulty: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
  servings: number | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  createdAt: string | null;
}

export interface RecipeSearchParams {
  q?: string;
  ingredients?: string;
  pantry?: boolean;
  cuisine?: string;
  diet?: string;
  mealType?: string;
  difficulty?: string;
  maxPrepTime?: number;
  maxCalories?: number;
  minProtein?: number;
  sort?: "relevance" | "newest" | "quickest" | "calories_asc" | "popular";
  source?: "all" | "personal" | "community" | "spoonacular";
  limit?: number;
  offset?: number;
}

export interface RecipeSearchResponse {
  results: SearchableRecipe[];
  total: number;
  offset: number;
  limit: number;
  query: {
    q: string | null;
    filters: Record<string, string | number | boolean>;
    sort: string;
  };
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit shared/types/recipe-search.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add shared/types/recipe-search.ts
git commit -m "feat(search): add shared SearchableRecipe types"
```

---

### Task 3: Add storage functions for index initialization

**Files:**

- Modify: `server/storage/meal-plans.ts`
- Modify: `server/storage/community.ts`
- Modify: `server/storage/index.ts`

These functions load all recipes from the database so the MiniSearch index can be populated on server startup. They are simple SELECT queries with no filtering beyond quality gates.

- [ ] **Step 1: Add `getAllMealPlanRecipes()` to `server/storage/meal-plans.ts`**

Add at the end of the MEAL PLAN RECIPES section (after `deleteMealPlanRecipe`, before the `getUnifiedRecipes` function around line 257):

```ts
/**
 * Load all meal-plan recipes for search index initialization.
 * No user filter — returns every recipe in the table.
 */
export async function getAllMealPlanRecipes(): Promise<MealPlanRecipe[]> {
  return db
    .select()
    .from(mealPlanRecipes)
    .orderBy(desc(mealPlanRecipes.createdAt));
}

/**
 * Load all recipe ingredients, keyed by recipeId, for search index initialization.
 */
export async function getAllRecipeIngredients(): Promise<
  Map<number, RecipeIngredient[]>
> {
  const rows = await db
    .select()
    .from(recipeIngredients)
    .orderBy(recipeIngredients.recipeId, recipeIngredients.displayOrder);

  const map = new Map<number, RecipeIngredient[]>();
  for (const row of rows) {
    const existing = map.get(row.recipeId);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.recipeId, [row]);
    }
  }
  return map;
}
```

- [ ] **Step 2: Add `getAllPublicCommunityRecipes()` to `server/storage/community.ts`**

Add after the `getFeaturedRecipes` function (after line 178):

```ts
/**
 * Load all public community recipes for search index initialization.
 */
export async function getAllPublicCommunityRecipes(): Promise<
  CommunityRecipe[]
> {
  return db
    .select()
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.isPublic, true),
        sql`COALESCE(jsonb_array_length(${communityRecipes.instructions}), 0) > 0`,
      ),
    )
    .orderBy(desc(communityRecipes.createdAt));
}
```

- [ ] **Step 3: Wire into `server/storage/index.ts`**

Add to the meal plans section (after `getPopularPicksByMealType` line ~119):

```ts
  getAllMealPlanRecipes: mealPlans.getAllMealPlanRecipes,
  getAllRecipeIngredients: mealPlans.getAllRecipeIngredients,
```

Add to the community section (find the community recipe entries, near `getFeaturedRecipes`):

```ts
  getAllPublicCommunityRecipes: community.getAllPublicCommunityRecipes,
```

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to these changes)

- [ ] **Step 5: Commit**

```bash
git add server/storage/meal-plans.ts server/storage/community.ts server/storage/index.ts
git commit -m "feat(search): add storage functions for index initialization"
```

---

### Task 4: Build the search service — normalizers and index setup

**Files:**

- Create: `server/services/recipe-search.ts`
- Test: `server/services/__tests__/recipe-search.test.ts`

This task creates the core search service with document normalizers, index initialization, and basic text search. Ingredient search, filtering, sorting, and Spoonacular integration are added in subsequent tasks.

- [ ] **Step 1: Write failing tests for normalizers**

Create `server/services/__tests__/recipe-search.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock storage before importing search service
vi.mock("../../storage", () => ({
  storage: {
    getAllMealPlanRecipes: vi.fn().mockResolvedValue([]),
    getAllPublicCommunityRecipes: vi.fn().mockResolvedValue([]),
    getAllRecipeIngredients: vi.fn().mockResolvedValue(new Map()),
    getPantryItems: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../services/recipe-catalog", () => ({
  searchCatalogRecipes: vi.fn().mockResolvedValue({
    results: [],
    offset: 0,
    number: 0,
    totalResults: 0,
  }),
  getCatalogRecipeDetail: vi.fn().mockResolvedValue(null),
}));

import {
  mealPlanToSearchable,
  communityToSearchable,
  initSearchIndex,
  searchRecipes,
} from "../recipe-search";
import { storage } from "../../storage";
import type { MealPlanRecipe, CommunityRecipe } from "@shared/schema";

const baseMealPlanRecipe: MealPlanRecipe = {
  id: 1,
  userId: "user1",
  title: "Chicken Parmesan",
  description: "Classic Italian comfort food",
  sourceType: "user_created",
  sourceUrl: null,
  externalId: null,
  cuisine: "Italian",
  difficulty: "Medium",
  servings: 4,
  prepTimeMinutes: 15,
  cookTimeMinutes: 30,
  imageUrl: null,
  instructions: ["Bread the chicken", "Bake with sauce"],
  dietTags: ["gluten free"],
  mealTypes: ["dinner"],
  caloriesPerServing: "450",
  proteinPerServing: "35",
  carbsPerServing: "20",
  fatPerServing: "25",
  fiberPerServing: null,
  sugarPerServing: null,
  sodiumPerServing: null,
  createdAt: new Date("2024-06-01"),
  updatedAt: new Date("2024-06-01"),
};

const baseCommunityRecipe: CommunityRecipe = {
  id: 10,
  authorId: "author1",
  barcode: null,
  normalizedProductName: "chicken",
  title: "Grilled Chicken Salad",
  description: "Healthy and fresh",
  difficulty: "Easy",
  timeEstimate: "20 min",
  servings: 2,
  dietTags: ["vegetarian"],
  instructions: ["Grill chicken", "Toss salad"],
  ingredients: [
    { name: "Chicken breast", quantity: "2", unit: "pieces" },
    { name: "Mixed greens", quantity: "4", unit: "cups" },
  ],
  imageUrl: null,
  isPublic: true,
  likeCount: 5,
  remixedFromId: null,
  remixedFromTitle: null,
  createdAt: new Date("2024-05-01"),
  updatedAt: new Date("2024-05-01"),
};

describe("recipe-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("mealPlanToSearchable", () => {
    it("normalizes a meal plan recipe into SearchableRecipe", () => {
      const result = mealPlanToSearchable(baseMealPlanRecipe, [
        "chicken breast",
        "parmesan cheese",
      ]);

      expect(result).toEqual({
        id: "personal:1",
        source: "personal",
        title: "Chicken Parmesan",
        description: "Classic Italian comfort food",
        ingredients: ["chicken breast", "parmesan cheese"],
        cuisine: "Italian",
        dietTags: ["gluten free"],
        mealTypes: ["dinner"],
        difficulty: "Medium",
        prepTimeMinutes: 15,
        cookTimeMinutes: 30,
        totalTimeMinutes: 45,
        caloriesPerServing: 450,
        proteinPerServing: 35,
        carbsPerServing: 20,
        fatPerServing: 25,
        servings: 4,
        imageUrl: null,
        sourceUrl: null,
        createdAt: "2024-06-01T00:00:00.000Z",
      });
    });

    it("handles null numeric fields", () => {
      const recipe = {
        ...baseMealPlanRecipe,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        caloriesPerServing: null,
        proteinPerServing: null,
      };
      const result = mealPlanToSearchable(recipe, []);
      expect(result.prepTimeMinutes).toBeNull();
      expect(result.cookTimeMinutes).toBeNull();
      expect(result.totalTimeMinutes).toBeNull();
      expect(result.caloriesPerServing).toBeNull();
      expect(result.proteinPerServing).toBeNull();
    });
  });

  describe("communityToSearchable", () => {
    it("normalizes a community recipe into SearchableRecipe", () => {
      const result = communityToSearchable(baseCommunityRecipe);

      expect(result).toEqual({
        id: "community:10",
        source: "community",
        title: "Grilled Chicken Salad",
        description: "Healthy and fresh",
        ingredients: ["Chicken breast", "Mixed greens"],
        cuisine: null,
        dietTags: ["vegetarian"],
        mealTypes: [],
        difficulty: "Easy",
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        totalTimeMinutes: null,
        caloriesPerServing: null,
        proteinPerServing: null,
        carbsPerServing: null,
        fatPerServing: null,
        servings: 2,
        imageUrl: null,
        sourceUrl: null,
        createdAt: "2024-05-01T00:00:00.000Z",
      });
    });

    it("extracts ingredient names from JSONB array", () => {
      const recipe = {
        ...baseCommunityRecipe,
        ingredients: [
          { name: "Tomato", quantity: "2", unit: "whole" },
          { name: "Basil", quantity: "5", unit: "leaves" },
        ],
      };
      const result = communityToSearchable(recipe);
      expect(result.ingredients).toEqual(["Tomato", "Basil"]);
    });
  });

  describe("initSearchIndex + searchRecipes", () => {
    it("initializes index and returns results for text search", async () => {
      vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue([
        baseMealPlanRecipe,
        {
          ...baseMealPlanRecipe,
          id: 2,
          title: "Beef Tacos",
          cuisine: "Mexican",
        },
      ]);
      vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([
        baseCommunityRecipe,
      ]);
      vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(new Map());

      await initSearchIndex();

      const result = await searchRecipes({ q: "chicken" }, "user1");
      expect(result.results.length).toBeGreaterThanOrEqual(2);
      expect(result.results.map((r) => r.title)).toContain("Chicken Parmesan");
      expect(result.results.map((r) => r.title)).toContain(
        "Grilled Chicken Salad",
      );
    });

    it("returns all recipes when no query is provided", async () => {
      vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue([
        baseMealPlanRecipe,
      ]);
      vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([
        baseCommunityRecipe,
      ]);
      vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(new Map());

      await initSearchIndex();

      const result = await searchRecipes({}, "user1");
      expect(result.results).toHaveLength(2);
    });

    it("handles fuzzy search (typo tolerance)", async () => {
      vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue([
        baseMealPlanRecipe,
      ]);
      vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([]);
      vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(new Map());

      await initSearchIndex();

      const result = await searchRecipes({ q: "chiken" }, "user1");
      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.results[0].title).toBe("Chicken Parmesan");
    });

    it("handles prefix search", async () => {
      vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue([
        baseMealPlanRecipe,
      ]);
      vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([]);
      vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(new Map());

      await initSearchIndex();

      const result = await searchRecipes({ q: "chic" }, "user1");
      expect(result.results.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty results for non-matching query", async () => {
      vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue([
        baseMealPlanRecipe,
      ]);
      vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([]);
      vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(new Map());

      await initSearchIndex();

      const result = await searchRecipes({ q: "xyznonexistent" }, "user1");
      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run server/services/__tests__/recipe-search.test.ts
```

Expected: FAIL — `recipe-search` module doesn't exist yet.

- [ ] **Step 3: Implement the search service**

Create `server/services/recipe-search.ts`:

```ts
import MiniSearch from "minisearch";
import type { MealPlanRecipe, CommunityRecipe } from "@shared/schema";
import type {
  SearchableRecipe,
  RecipeSearchParams,
  RecipeSearchResponse,
} from "@shared/types/recipe-search";
import { storage } from "../storage";
import { createServiceLogger } from "../lib/logger";

const log = createServiceLogger("recipe-search");

// ── Normalizers ─────────────────────────────────────────────────────

function parseNum(val: string | null | undefined): number | null {
  if (val == null) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

export function mealPlanToSearchable(
  recipe: MealPlanRecipe,
  ingredientNames: string[],
): SearchableRecipe {
  const prep = recipe.prepTimeMinutes ?? null;
  const cook = recipe.cookTimeMinutes ?? null;
  const total = prep != null || cook != null ? (prep ?? 0) + (cook ?? 0) : null;

  return {
    id: `personal:${recipe.id}`,
    source: "personal",
    title: recipe.title,
    description: recipe.description ?? null,
    ingredients: ingredientNames,
    cuisine: recipe.cuisine ?? null,
    dietTags: recipe.dietTags ?? [],
    mealTypes: recipe.mealTypes ?? [],
    difficulty: recipe.difficulty ?? null,
    prepTimeMinutes: prep,
    cookTimeMinutes: cook,
    totalTimeMinutes: total,
    caloriesPerServing: parseNum(recipe.caloriesPerServing),
    proteinPerServing: parseNum(recipe.proteinPerServing),
    carbsPerServing: parseNum(recipe.carbsPerServing),
    fatPerServing: parseNum(recipe.fatPerServing),
    servings: recipe.servings ?? null,
    imageUrl: recipe.imageUrl ?? null,
    sourceUrl: recipe.sourceUrl ?? null,
    createdAt: recipe.createdAt?.toISOString() ?? null,
  };
}

export function communityToSearchable(
  recipe: CommunityRecipe,
): SearchableRecipe {
  // Community recipes store ingredients as JSONB array of {name, quantity, unit}
  const ingredients: string[] = Array.isArray(recipe.ingredients)
    ? (recipe.ingredients as { name: string }[]).map((i) => i.name)
    : [];

  return {
    id: `community:${recipe.id}`,
    source: "community",
    title: recipe.title,
    description: recipe.description ?? null,
    ingredients,
    cuisine: null, // community recipes don't have a cuisine column
    dietTags: recipe.dietTags ?? [],
    mealTypes: [], // community recipes don't have mealTypes
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
    createdAt: recipe.createdAt?.toISOString() ?? null,
  };
}

// ── Index Singleton ─────────────────────────────────────────────────

let index: MiniSearch<SearchableRecipe> | null = null;
// Store full documents for retrieval (MiniSearch only returns ids + score)
const documentStore = new Map<string, SearchableRecipe>();

function createIndex(): MiniSearch<SearchableRecipe> {
  return new MiniSearch<SearchableRecipe>({
    fields: ["title", "ingredients", "description", "cuisine", "dietTags"],
    storeFields: [], // we use documentStore instead
    searchOptions: {
      boost: { title: 3, ingredients: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
    idField: "id",
    // Custom field extraction for array fields
    extractField: (doc, fieldName) => {
      const val = doc[fieldName as keyof SearchableRecipe];
      if (Array.isArray(val)) return val.join(" ");
      return val as string;
    },
  });
}

export async function initSearchIndex(): Promise<void> {
  index = createIndex();
  documentStore.clear();

  const [mealPlanRecipes, communityRecipes, ingredientMap] = await Promise.all([
    storage.getAllMealPlanRecipes(),
    storage.getAllPublicCommunityRecipes(),
    storage.getAllRecipeIngredients(),
  ]);

  const docs: SearchableRecipe[] = [];

  for (const recipe of mealPlanRecipes) {
    const ingNames = (ingredientMap.get(recipe.id) ?? []).map((i) => i.name);
    docs.push(mealPlanToSearchable(recipe, ingNames));
  }

  for (const recipe of communityRecipes) {
    docs.push(communityToSearchable(recipe));
  }

  index.addAll(docs);
  for (const doc of docs) {
    documentStore.set(doc.id, doc);
  }

  log.info(
    {
      personalCount: mealPlanRecipes.length,
      communityCount: communityRecipes.length,
    },
    "Search index initialized",
  );
}

// ── Index Mutation Hooks ────────────────────────────────────────────

export function addToIndex(doc: SearchableRecipe): void {
  if (!index) return;
  // Remove first if exists (handles updates)
  if (documentStore.has(doc.id)) {
    index.discard(doc.id);
  }
  index.add(doc);
  documentStore.set(doc.id, doc);
}

export function removeFromIndex(id: string): void {
  if (!index) return;
  if (documentStore.has(id)) {
    index.discard(id);
    documentStore.delete(id);
  }
}

// ── Search ──────────────────────────────────────────────────────────

export async function searchRecipes(
  params: RecipeSearchParams,
  userId: string,
): Promise<RecipeSearchResponse> {
  if (!index) {
    await initSearchIndex();
  }

  const {
    q,
    ingredients: ingredientsCsv,
    pantry,
    cuisine,
    diet,
    mealType,
    difficulty,
    maxPrepTime,
    maxCalories,
    minProtein,
    sort = "relevance",
    source = "all",
    limit = 20,
    offset = 0,
  } = params;

  // Resolve pantry ingredients if requested
  let ingredientTerms: string[] = [];
  if (ingredientsCsv) {
    ingredientTerms = ingredientsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (pantry && userId) {
    const pantryItems = await storage.getPantryItems(userId);
    const pantryNames = pantryItems.map((item) => item.name);
    ingredientTerms = [...ingredientTerms, ...pantryNames];
  }

  // Get all documents — either via text search or full index scan
  let results: SearchableRecipe[];

  if (q) {
    const searchResults = index!.search(q);
    results = searchResults
      .map((r) => documentStore.get(r.id))
      .filter((doc): doc is SearchableRecipe => doc != null);
  } else if (ingredientTerms.length > 0) {
    // Search by ingredients only
    const searchResults = index!.search(ingredientTerms.join(" "), {
      fields: ["ingredients"],
    });
    results = searchResults
      .map((r) => documentStore.get(r.id))
      .filter((doc): doc is SearchableRecipe => doc != null);
  } else {
    // No query — return all documents
    results = Array.from(documentStore.values());
  }

  // If we have both q and ingredient terms, filter q results by ingredient match
  if (q && ingredientTerms.length > 0) {
    const lowerTerms = ingredientTerms.map((t) => t.toLowerCase());
    results = results.filter((doc) => {
      const docIngredients = doc.ingredients.map((i) => i.toLowerCase());
      return lowerTerms.some((term) =>
        docIngredients.some((ing) => ing.includes(term)),
      );
    });
  }

  // ── Post-search filters ───────────────────────────────────────
  if (source !== "all") {
    results = results.filter((r) => r.source === source);
  }

  if (cuisine) {
    const lower = cuisine.toLowerCase();
    results = results.filter(
      (r) =>
        r.cuisine?.toLowerCase() === lower ||
        r.dietTags.some((t) => t.toLowerCase() === lower),
    );
  }

  if (diet) {
    const lower = diet.toLowerCase();
    results = results.filter((r) =>
      r.dietTags.some((t) => t.toLowerCase() === lower),
    );
  }

  if (mealType) {
    const lower = mealType.toLowerCase();
    results = results.filter(
      (r) =>
        r.mealTypes.length === 0 ||
        r.mealTypes.some((t) => t.toLowerCase() === lower),
    );
  }

  if (difficulty) {
    const lower = difficulty.toLowerCase();
    results = results.filter((r) => r.difficulty?.toLowerCase() === lower);
  }

  if (maxPrepTime != null) {
    results = results.filter(
      (r) => r.totalTimeMinutes == null || r.totalTimeMinutes <= maxPrepTime,
    );
  }

  if (maxCalories != null) {
    results = results.filter(
      (r) =>
        r.caloriesPerServing == null || r.caloriesPerServing <= maxCalories,
    );
  }

  if (minProtein != null) {
    results = results.filter(
      (r) => r.proteinPerServing == null || r.proteinPerServing >= minProtein,
    );
  }

  // ── Sorting ───────────────────────────────────────────────────
  if (sort !== "relevance" || !q) {
    // relevance only applies when there's a text query (MiniSearch order)
    switch (sort) {
      case "newest":
        results.sort((a, b) => {
          const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const db2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return db2 - da;
        });
        break;
      case "quickest":
        results.sort((a, b) => {
          const ta = a.totalTimeMinutes ?? Infinity;
          const tb = b.totalTimeMinutes ?? Infinity;
          return ta - tb;
        });
        break;
      case "calories_asc":
        results.sort((a, b) => {
          const ca = a.caloriesPerServing ?? Infinity;
          const cb = b.caloriesPerServing ?? Infinity;
          return ca - cb;
        });
        break;
      case "popular":
        // For now, newest first as popularity data isn't in SearchableRecipe
        results.sort((a, b) => {
          const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const db2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return db2 - da;
        });
        break;
      default:
        // "relevance" without query → newest first
        results.sort((a, b) => {
          const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const db2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return db2 - da;
        });
    }
  }

  // ── Pagination ────────────────────────────────────────────────
  const total = results.length;
  const paged = results.slice(offset, offset + limit);

  const filters: Record<string, string | number | boolean> = {};
  if (cuisine) filters.cuisine = cuisine;
  if (diet) filters.diet = diet;
  if (mealType) filters.mealType = mealType;
  if (difficulty) filters.difficulty = difficulty;
  if (maxPrepTime != null) filters.maxPrepTime = maxPrepTime;
  if (maxCalories != null) filters.maxCalories = maxCalories;
  if (minProtein != null) filters.minProtein = minProtein;
  if (source !== "all") filters.source = source;
  if (pantry) filters.pantry = true;
  if (ingredientsCsv) filters.ingredients = ingredientsCsv;

  return {
    results: paged,
    total,
    offset,
    limit,
    query: {
      q: q ?? null,
      filters,
      sort,
    },
  };
}

/** Reset the index. Exported for testing. */
export function resetSearchIndex(): void {
  index = null;
  documentStore.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run server/services/__tests__/recipe-search.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/recipe-search.ts server/services/__tests__/recipe-search.test.ts
git commit -m "feat(search): MiniSearch service with normalizers, index init, text search"
```

---

### Task 5: Add filtering and sorting tests

**Files:**

- Modify: `server/services/__tests__/recipe-search.test.ts`

This task adds tests for post-search filters (cuisine, diet, difficulty, maxPrepTime, maxCalories, minProtein, source), sorting, pagination, and ingredient search.

- [ ] **Step 1: Add filter, sort, and pagination tests**

Append to the existing test file, inside the `describe("recipe-search")` block:

```ts
describe("filtering", () => {
  beforeEach(async () => {
    vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue([
      baseMealPlanRecipe,
      {
        ...baseMealPlanRecipe,
        id: 2,
        title: "Beef Tacos",
        cuisine: "Mexican",
        dietTags: ["keto"],
        difficulty: "Easy",
        prepTimeMinutes: 10,
        cookTimeMinutes: 15,
        caloriesPerServing: "350",
        proteinPerServing: "28",
      },
      {
        ...baseMealPlanRecipe,
        id: 3,
        title: "Veggie Stir Fry",
        cuisine: "Asian",
        dietTags: ["vegetarian", "vegan"],
        difficulty: "Easy",
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        caloriesPerServing: "200",
        proteinPerServing: "8",
      },
    ]);
    vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([
      baseCommunityRecipe,
    ]);
    vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(new Map());
    await initSearchIndex();
  });

  it("filters by cuisine", async () => {
    const result = await searchRecipes({ cuisine: "Mexican" }, "user1");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe("Beef Tacos");
  });

  it("filters by diet", async () => {
    const result = await searchRecipes({ diet: "vegetarian" }, "user1");
    // Community recipe (vegetarian) + Veggie Stir Fry (vegetarian, vegan)
    expect(result.results).toHaveLength(2);
  });

  it("filters by difficulty", async () => {
    const result = await searchRecipes({ difficulty: "Easy" }, "user1");
    // Beef Tacos + Veggie Stir Fry + Community recipe
    expect(result.results).toHaveLength(3);
  });

  it("filters by maxPrepTime", async () => {
    const result = await searchRecipes({ maxPrepTime: 20 }, "user1");
    // Recipes with totalTime <= 20: Stir Fry (15 min). Community has null (included).
    expect(
      result.results.every(
        (r) => r.totalTimeMinutes == null || r.totalTimeMinutes <= 20,
      ),
    ).toBe(true);
  });

  it("filters by maxCalories", async () => {
    const result = await searchRecipes({ maxCalories: 300 }, "user1");
    expect(
      result.results.every(
        (r) => r.caloriesPerServing == null || r.caloriesPerServing <= 300,
      ),
    ).toBe(true);
  });

  it("filters by minProtein", async () => {
    const result = await searchRecipes({ minProtein: 30 }, "user1");
    expect(
      result.results.every(
        (r) => r.proteinPerServing == null || r.proteinPerServing >= 30,
      ),
    ).toBe(true);
  });

  it("filters by source", async () => {
    const result = await searchRecipes({ source: "community" }, "user1");
    expect(result.results.every((r) => r.source === "community")).toBe(true);
  });

  it("combines multiple filters", async () => {
    const result = await searchRecipes(
      { cuisine: "Italian", difficulty: "Medium" },
      "user1",
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe("Chicken Parmesan");
  });
});

describe("sorting", () => {
  beforeEach(async () => {
    vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue([
      {
        ...baseMealPlanRecipe,
        id: 1,
        title: "Slow Roast",
        prepTimeMinutes: 30,
        cookTimeMinutes: 120,
        caloriesPerServing: "600",
        createdAt: new Date("2024-01-01"),
      },
      {
        ...baseMealPlanRecipe,
        id: 2,
        title: "Quick Salad",
        prepTimeMinutes: 5,
        cookTimeMinutes: 0,
        caloriesPerServing: "150",
        createdAt: new Date("2024-06-01"),
      },
      {
        ...baseMealPlanRecipe,
        id: 3,
        title: "Medium Bowl",
        prepTimeMinutes: 15,
        cookTimeMinutes: 15,
        caloriesPerServing: "400",
        createdAt: new Date("2024-03-01"),
      },
    ]);
    vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([]);
    vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(new Map());
    await initSearchIndex();
  });

  it("sorts by newest", async () => {
    const result = await searchRecipes({ sort: "newest" }, "user1");
    expect(result.results.map((r) => r.title)).toEqual([
      "Quick Salad",
      "Medium Bowl",
      "Slow Roast",
    ]);
  });

  it("sorts by quickest", async () => {
    const result = await searchRecipes({ sort: "quickest" }, "user1");
    expect(result.results.map((r) => r.title)).toEqual([
      "Quick Salad",
      "Medium Bowl",
      "Slow Roast",
    ]);
  });

  it("sorts by calories ascending", async () => {
    const result = await searchRecipes({ sort: "calories_asc" }, "user1");
    expect(result.results.map((r) => r.title)).toEqual([
      "Quick Salad",
      "Medium Bowl",
      "Slow Roast",
    ]);
  });
});

describe("pagination", () => {
  beforeEach(async () => {
    const recipes = Array.from({ length: 5 }, (_, i) => ({
      ...baseMealPlanRecipe,
      id: i + 1,
      title: `Recipe ${i + 1}`,
      createdAt: new Date(`2024-0${i + 1}-01`),
    }));
    vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue(recipes);
    vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([]);
    vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(new Map());
    await initSearchIndex();
  });

  it("limits results", async () => {
    const result = await searchRecipes({ limit: 2 }, "user1");
    expect(result.results).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it("offsets results", async () => {
    const result = await searchRecipes(
      { limit: 2, offset: 2, sort: "newest" },
      "user1",
    );
    expect(result.results).toHaveLength(2);
    expect(result.offset).toBe(2);
  });
});

describe("ingredient search", () => {
  beforeEach(async () => {
    vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue([
      baseMealPlanRecipe,
    ]);
    vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([
      baseCommunityRecipe,
    ]);
    const ingMap = new Map([
      [
        1,
        [
          {
            id: 1,
            recipeId: 1,
            name: "chicken breast",
            quantity: "2",
            unit: "lb",
            category: "protein",
            displayOrder: 0,
          },
          {
            id: 2,
            recipeId: 1,
            name: "parmesan cheese",
            quantity: "1",
            unit: "cup",
            category: "dairy",
            displayOrder: 1,
          },
        ],
      ],
    ]);
    vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(ingMap);
    await initSearchIndex();
  });

  it("searches by ingredient name", async () => {
    const result = await searchRecipes({ ingredients: "chicken" }, "user1");
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });

  it("searches by multiple ingredients", async () => {
    const result = await searchRecipes(
      { ingredients: "chicken,parmesan" },
      "user1",
    );
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });
});

describe("index mutation hooks", () => {
  beforeEach(async () => {
    vi.mocked(storage.getAllMealPlanRecipes).mockResolvedValue([]);
    vi.mocked(storage.getAllPublicCommunityRecipes).mockResolvedValue([]);
    vi.mocked(storage.getAllRecipeIngredients).mockResolvedValue(new Map());
    await initSearchIndex();
  });

  it("addToIndex makes recipe searchable", async () => {
    const { addToIndex } = await import("../recipe-search");
    addToIndex(mealPlanToSearchable(baseMealPlanRecipe, ["chicken"]));

    const result = await searchRecipes({ q: "chicken" }, "user1");
    expect(result.results).toHaveLength(1);
  });

  it("removeFromIndex removes recipe from results", async () => {
    const { addToIndex, removeFromIndex } = await import("../recipe-search");
    addToIndex(mealPlanToSearchable(baseMealPlanRecipe, ["chicken"]));
    removeFromIndex("personal:1");

    const result = await searchRecipes({ q: "chicken" }, "user1");
    expect(result.results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run server/services/__tests__/recipe-search.test.ts
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/services/__tests__/recipe-search.test.ts
git commit -m "test(search): add filter, sort, pagination, ingredient search tests"
```

---

### Task 6: Add the search route endpoint

**Files:**

- Modify: `server/routes/recipes.ts`
- Modify: `server/routes/__tests__/recipes.test.ts`

- [ ] **Step 1: Write failing route tests**

Add to `server/routes/__tests__/recipes.test.ts`. First, add the search service mock at the top of the file (alongside other mocks):

```ts
vi.mock("../../services/recipe-search", () => ({
  searchRecipes: vi.fn().mockResolvedValue({
    results: [],
    total: 0,
    offset: 0,
    limit: 20,
    query: { q: null, filters: {}, sort: "relevance" },
  }),
  initSearchIndex: vi.fn().mockResolvedValue(undefined),
}));
```

Add the import:

```ts
import { searchRecipes } from "../../services/recipe-search";
```

Then add tests inside the `describe("Recipes Routes")` block:

```ts
describe("GET /api/recipes/search", () => {
  it("returns 200 with search results", async () => {
    vi.mocked(searchRecipes).mockResolvedValue({
      results: [
        {
          id: "personal:1",
          source: "personal",
          title: "Chicken Parmesan",
          description: null,
          ingredients: [],
          cuisine: "Italian",
          dietTags: [],
          mealTypes: [],
          difficulty: null,
          prepTimeMinutes: null,
          cookTimeMinutes: null,
          totalTimeMinutes: null,
          caloriesPerServing: null,
          proteinPerServing: null,
          carbsPerServing: null,
          fatPerServing: null,
          servings: null,
          imageUrl: null,
          sourceUrl: null,
          createdAt: null,
        },
      ],
      total: 1,
      offset: 0,
      limit: 20,
      query: { q: "chicken", filters: {}, sort: "relevance" },
    });

    const res = await request(app).get("/api/recipes/search?q=chicken");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it("validates q max length", async () => {
    const longQ = "a".repeat(201);
    const res = await request(app).get(`/api/recipes/search?q=${longQ}`);
    expect(res.status).toBe(400);
  });

  it("validates limit range", async () => {
    const res = await request(app).get("/api/recipes/search?limit=100");
    expect(res.status).toBe(400);
  });

  it("validates sort enum", async () => {
    const res = await request(app).get("/api/recipes/search?sort=invalid");
    expect(res.status).toBe(400);
  });

  it("passes filter params to searchRecipes", async () => {
    await request(app).get(
      "/api/recipes/search?q=pasta&cuisine=Italian&diet=vegetarian&sort=quickest",
    );
    expect(searchRecipes).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "pasta",
        cuisine: "Italian",
        diet: "vegetarian",
        sort: "quickest",
      }),
      expect.any(String),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run server/routes/__tests__/recipes.test.ts
```

Expected: FAIL — `/api/recipes/search` route doesn't exist yet.

- [ ] **Step 3: Add the search route**

In `server/routes/recipes.ts`, add the import at the top:

```ts
import { searchRecipes } from "../services/recipe-search";
```

Add the Zod schema after the existing `browseQuerySchema`:

```ts
const searchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  ingredients: z.string().max(500).optional(),
  pantry: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cuisine: z.string().max(50).optional(),
  diet: z.string().max(50).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  maxPrepTime: z.coerce.number().int().min(1).max(480).optional(),
  maxCalories: z.coerce.number().int().min(1).max(5000).optional(),
  minProtein: z.coerce.number().int().min(0).max(500).optional(),
  sort: z
    .enum(["relevance", "newest", "quickest", "calories_asc", "popular"])
    .optional(),
  source: z.enum(["all", "personal", "community", "spoonacular"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
```

Add the route inside the `register` function, before the existing `GET /api/recipes/browse`:

```ts
// GET /api/recipes/search - Unified recipe search
app.get(
  "/api/recipes/search",
  requireAuth,
  instructionsRateLimit,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        sendError(
          res,
          400,
          formatZodError(parsed.error),
          ErrorCode.VALIDATION_ERROR,
        );
        return;
      }

      const result = await searchRecipes(parsed.data, req.userId);
      res.json(result);
    } catch (error) {
      logger.error({ err: toError(error) }, "recipe search failed");
      sendError(res, 500, "Failed to search recipes", ErrorCode.INTERNAL_ERROR);
    }
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run server/routes/__tests__/recipes.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/recipes.ts server/routes/__tests__/recipes.test.ts
git commit -m "feat(search): add GET /api/recipes/search endpoint with Zod validation"
```

---

### Task 7: Initialize the search index on server startup

**Files:**

- Modify: `server/routes.ts` (or wherever the server starts)

Check `server/index.ts` or `server/app.ts` for the startup sequence. The index should initialize after DB is ready.

- [ ] **Step 1: Add search index initialization to server startup**

In `server/routes.ts`, import and call `initSearchIndex`:

```ts
import { initSearchIndex } from "./services/recipe-search";
```

In the `registerRoutes` function, add after all routes are registered (before creating the HTTP server):

```ts
// Initialize search index (non-blocking — server starts even if index fails)
initSearchIndex().catch((err) => {
  console.error("Failed to initialize search index:", err);
});
```

- [ ] **Step 2: Verify server starts without errors**

```bash
npm run server:dev &
sleep 3
curl -s http://localhost:3000/api/health | head -20
kill %1
```

Expected: health check returns `{"status":"ok"}` and logs show "Search index initialized"

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat(search): initialize MiniSearch index on server startup"
```

---

### Task 8: Add index hooks to storage CRUD functions

**Files:**

- Modify: `server/storage/meal-plans.ts`
- Modify: `server/storage/community.ts`

When recipes are created, updated, or deleted, the search index must be updated. These are thin, direct function calls — not an event system.

- [ ] **Step 1: Add index hooks to meal-plan recipe CRUD**

In `server/storage/meal-plans.ts`, add the import at the top:

```ts
import {
  addToIndex,
  removeFromIndex,
  mealPlanToSearchable,
} from "../services/recipe-search";
```

Modify `createMealPlanRecipe` — add after the `return created;` statements (both paths):

```ts
// Update search index
const ingNames = ingredients?.map((i) => i.name) ?? [];
addToIndex(mealPlanToSearchable(created, ingNames));
```

Modify `updateMealPlanRecipe` — add after `return recipe || undefined;`:

```ts
if (recipe) {
  // Fetch ingredient names for the updated recipe
  const ings = await db
    .select({ name: recipeIngredients.name })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, id));
  addToIndex(
    mealPlanToSearchable(
      recipe,
      ings.map((i) => i.name),
    ),
  );
}
```

Modify `deleteMealPlanRecipe` — add inside the transaction, after the delete returns true:

```ts
removeFromIndex(`personal:${id}`);
```

- [ ] **Step 2: Add index hooks to community recipe CRUD**

In `server/storage/community.ts`, add the import at the top:

```ts
import {
  addToIndex,
  removeFromIndex,
  communityToSearchable,
} from "../services/recipe-search";
```

Modify `createCommunityRecipe` — add after `return recipe;`:

```ts
if (recipe.isPublic) {
  addToIndex(communityToSearchable(recipe));
}
```

Modify `createRecipeWithLimitCheck` — add after the recipe is created inside the transaction (after `const [recipe] = await tx.insert(...)`):

```ts
// Index update happens outside transaction (after commit) — but recipe is returned
// so caller can trigger it. We do it here since the recipe is public by default=false,
// and only public recipes are indexed.
```

Actually, generated recipes start as `isPublic: false`, so no index update needed at creation. The index is updated when the recipe is shared publicly via `updateRecipePublicStatus`.

Modify `updateRecipePublicStatus` — add after `return recipe || undefined;`:

```ts
if (recipe) {
  if (recipe.isPublic) {
    addToIndex(communityToSearchable(recipe));
  } else {
    removeFromIndex(`community:${recipe.id}`);
  }
}
```

Modify `deleteCommunityRecipe` — add inside the transaction, after the delete returns true:

```ts
removeFromIndex(`community:${recipeId}`);
```

- [ ] **Step 3: Run all tests to verify nothing broke**

```bash
npm run test:run
```

Expected: all tests pass. The search service functions are no-ops when the index isn't initialized (the `if (!index) return;` guard), so existing tests that don't initialize the index won't be affected.

- [ ] **Step 4: Commit**

```bash
git add server/storage/meal-plans.ts server/storage/community.ts
git commit -m "feat(search): add index hooks to recipe CRUD functions"
```

---

### Task 9: Create the client search hook

**Files:**

- Create: `client/hooks/useRecipeSearch.ts`
- Test: `client/hooks/__tests__/useRecipeSearch.test.ts`

- [ ] **Step 1: Write failing tests**

Create `client/hooks/__tests__/useRecipeSearch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRecipeSearch } from "../useRecipeSearch";

vi.mock("@/lib/query-client", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "@/lib/query-client";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const mockResponse = {
  results: [
    {
      id: "personal:1",
      source: "personal",
      title: "Test Recipe",
      description: null,
      ingredients: [],
      cuisine: null,
      dietTags: [],
      mealTypes: [],
      difficulty: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      caloriesPerServing: null,
      proteinPerServing: null,
      carbsPerServing: null,
      fatPerServing: null,
      servings: null,
      imageUrl: null,
      sourceUrl: null,
      createdAt: null,
    },
  ],
  total: 1,
  offset: 0,
  limit: 20,
  query: { q: "test", filters: {}, sort: "relevance" },
};

describe("useRecipeSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);
  });

  it("fetches search results", async () => {
    const { result } = renderHook(() => useRecipeSearch({ q: "test" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.results).toHaveLength(1);
  });

  it("builds query string from params", async () => {
    renderHook(
      () =>
        useRecipeSearch({
          q: "pasta",
          cuisine: "Italian",
          sort: "newest",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "GET",
        expect.stringContaining("q=pasta"),
      );
    });
    expect(apiRequest).toHaveBeenCalledWith(
      "GET",
      expect.stringContaining("cuisine=Italian"),
    );
  });

  it("does not fetch when params are null", async () => {
    const { result } = renderHook(() => useRecipeSearch(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run client/hooks/__tests__/useRecipeSearch.test.ts
```

Expected: FAIL — `useRecipeSearch` doesn't exist yet.

- [ ] **Step 3: Implement the hook**

Create `client/hooks/useRecipeSearch.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type {
  RecipeSearchParams,
  RecipeSearchResponse,
} from "@shared/types/recipe-search";

export function useRecipeSearch(params: RecipeSearchParams | null) {
  const qs = params
    ? new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== "" && v !== false)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";

  return useQuery<RecipeSearchResponse>({
    queryKey: ["/api/recipes/search", params ?? {}],
    queryFn: async () => {
      const url = qs ? `/api/recipes/search?${qs}` : "/api/recipes/search";
      const res = await apiRequest("GET", url);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: params !== null,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run client/hooks/__tests__/useRecipeSearch.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useRecipeSearch.ts client/hooks/__tests__/useRecipeSearch.test.ts
git commit -m "feat(search): add useRecipeSearch TanStack Query hook"
```

---

### Task 10: Create the SearchFilterSheet component

**Files:**

- Create: `client/components/meal-plan/SearchFilterSheet.tsx`
- Test: `client/components/meal-plan/__tests__/SearchFilterSheet.test.tsx`

This is the advanced filters bottom sheet, triggered by a filter icon in the chip row. Uses `@gorhom/bottom-sheet` (already installed) and `@react-native-community/slider`.

- [ ] **Step 1: Write failing tests**

Create `client/components/meal-plan/__tests__/SearchFilterSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react-native";
import React from "react";
import { SearchFilterSheet } from "../SearchFilterSheet";

// Mock bottom sheet
vi.mock("@gorhom/bottom-sheet", () => {
  const React = require("react");
  return {
    BottomSheetModal: React.forwardRef(
      ({ children }: { children: React.ReactNode }, _ref: unknown) =>
        React.createElement("View", { testID: "bottom-sheet" }, children),
    ),
    BottomSheetBackdrop: () => null,
    BottomSheetView: ({ children }: { children: React.ReactNode }) =>
      React.createElement("View", null, children),
  };
});

vi.mock("@react-native-community/slider", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: (props: { testID?: string }) =>
      React.createElement("View", { testID: props.testID ?? "slider" }),
  };
});

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      text: "#000000",
      textSecondary: "#666666",
      backgroundRoot: "#FFFFFF",
      link: "#007AFF",
      buttonText: "#FFFFFF",
      border: "#CCCCCC",
    },
  }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection: vi.fn(), impact: vi.fn() }),
}));

describe("SearchFilterSheet", () => {
  const defaultFilters = {
    sort: "relevance" as const,
    maxPrepTime: undefined,
    maxCalories: undefined,
    minProtein: undefined,
    source: "all" as const,
  };

  it("renders sort options", () => {
    const { getByText } = render(
      <SearchFilterSheet
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onReset={vi.fn()}
        activeFilterCount={0}
      />,
    );
    expect(getByText("Relevance")).toBeTruthy();
    expect(getByText("Newest")).toBeTruthy();
    expect(getByText("Quickest")).toBeTruthy();
  });

  it("renders source options", () => {
    const { getByText } = render(
      <SearchFilterSheet
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onReset={vi.fn()}
        activeFilterCount={0}
      />,
    );
    expect(getByText("All")).toBeTruthy();
    expect(getByText("My Recipes")).toBeTruthy();
    expect(getByText("Community")).toBeTruthy();
  });

  it("calls onReset when reset button is pressed", () => {
    const onReset = vi.fn();
    const { getByText } = render(
      <SearchFilterSheet
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onReset={onReset}
        activeFilterCount={2}
      />,
    );
    fireEvent.press(getByText("Reset filters"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("calls onFiltersChange when sort option is selected", () => {
    const onFiltersChange = vi.fn();
    const { getByText } = render(
      <SearchFilterSheet
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        onReset={vi.fn()}
        activeFilterCount={0}
      />,
    );
    fireEvent.press(getByText("Newest"));
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "newest" }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run client/components/meal-plan/__tests__/SearchFilterSheet.test.tsx
```

Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Implement the SearchFilterSheet**

Create `client/components/meal-plan/SearchFilterSheet.tsx`:

```tsx
import React, { useCallback } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import Slider from "@react-native-community/slider";

import { ThemedText } from "@/components/ThemedText";
import { Chip } from "@/components/Chip";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

type SortOption =
  | "relevance"
  | "newest"
  | "quickest"
  | "calories_asc"
  | "popular";
type SourceOption = "all" | "personal" | "community" | "spoonacular";

export interface SearchFilters {
  sort: SortOption;
  maxPrepTime: number | undefined;
  maxCalories: number | undefined;
  minProtein: number | undefined;
  source: SourceOption;
}

interface SearchFilterSheetProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  onReset: () => void;
  activeFilterCount: number;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "quickest", label: "Quickest" },
  { value: "calories_asc", label: "Lowest Calories" },
  { value: "popular", label: "Most Popular" },
];

const SOURCE_OPTIONS: { value: SourceOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "personal", label: "My Recipes" },
  { value: "community", label: "Community" },
  { value: "spoonacular", label: "Online" },
];

export function SearchFilterSheet({
  filters,
  onFiltersChange,
  onReset,
  activeFilterCount,
}: SearchFilterSheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const updateFilter = useCallback(
    <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
      haptics.selection();
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange, haptics],
  );

  return (
    <View style={styles.container}>
      {/* Sort */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Sort by
      </ThemedText>
      <View style={styles.chipRow}>
        {SORT_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            variant="filter"
            selected={filters.sort === opt.value}
            onPress={() => updateFilter("sort", opt.value)}
          />
        ))}
      </View>

      {/* Prep Time */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Max prep time:{" "}
        {filters.maxPrepTime ? `${filters.maxPrepTime} min` : "Any"}
      </ThemedText>
      <Slider
        testID="prep-time-slider"
        style={styles.slider}
        minimumValue={0}
        maximumValue={120}
        step={5}
        value={filters.maxPrepTime ?? 0}
        onSlidingComplete={(val: number) =>
          updateFilter("maxPrepTime", val > 0 ? val : undefined)
        }
        minimumTrackTintColor={theme.link}
        maximumTrackTintColor={withOpacity(theme.text, 0.15)}
        thumbTintColor={theme.link}
      />

      {/* Calories */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Max calories:{" "}
        {filters.maxCalories ? `${filters.maxCalories} cal` : "Any"}
      </ThemedText>
      <Slider
        testID="calories-slider"
        style={styles.slider}
        minimumValue={0}
        maximumValue={1000}
        step={50}
        value={filters.maxCalories ?? 0}
        onSlidingComplete={(val: number) =>
          updateFilter("maxCalories", val > 0 ? val : undefined)
        }
        minimumTrackTintColor={theme.link}
        maximumTrackTintColor={withOpacity(theme.text, 0.15)}
        thumbTintColor={theme.link}
      />

      {/* Protein */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Min protein: {filters.minProtein ? `${filters.minProtein}g` : "Any"}
      </ThemedText>
      <Slider
        testID="protein-slider"
        style={styles.slider}
        minimumValue={0}
        maximumValue={60}
        step={5}
        value={filters.minProtein ?? 0}
        onSlidingComplete={(val: number) =>
          updateFilter("minProtein", val > 0 ? val : undefined)
        }
        minimumTrackTintColor={theme.link}
        maximumTrackTintColor={withOpacity(theme.text, 0.15)}
        thumbTintColor={theme.link}
      />

      {/* Source */}
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        Source
      </ThemedText>
      <View style={styles.chipRow}>
        {SOURCE_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            variant="filter"
            selected={filters.source === opt.value}
            onPress={() => updateFilter("source", opt.value)}
          />
        ))}
      </View>

      {/* Reset */}
      {activeFilterCount > 0 && (
        <Pressable
          onPress={() => {
            haptics.selection();
            onReset();
          }}
          style={[
            styles.resetButton,
            { borderColor: withOpacity(theme.text, 0.15) },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Reset filters"
        >
          <ThemedText style={[styles.resetText, { color: theme.link }]}>
            Reset filters
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  sectionTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: 14,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  slider: {
    width: "100%",
    height: 40,
  },
  resetButton: {
    marginTop: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    alignItems: "center",
  },
  resetText: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run client/components/meal-plan/__tests__/SearchFilterSheet.test.tsx
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add client/components/meal-plan/SearchFilterSheet.tsx client/components/meal-plan/__tests__/SearchFilterSheet.test.tsx
git commit -m "feat(search): add SearchFilterSheet component with sort, sliders, source picker"
```

---

### Task 11: Update RecipeBrowserScreen to use new search

**Files:**

- Modify: `client/screens/meal-plan/RecipeBrowserScreen.tsx`

This is the largest client-side change. Replace `useUnifiedRecipes` with `useRecipeSearch`, add the filter sheet trigger, difficulty chips, pantry toggle, "Quick meals" shortcut, ingredient search chip, and source badges on cards.

- [ ] **Step 1: Update imports and state**

Replace the import of `useUnifiedRecipes` and `useCatalogSearch` with the new hook. Add new state variables for advanced filters and ingredient search. Add the bottom sheet import and ref.

At the top of `RecipeBrowserScreen.tsx`, update imports:

```ts
// Remove these imports from useMealPlanRecipes:
//   useCatalogSearch, useUnifiedRecipes, CatalogSearchResult, CatalogSearchParams

// Add:
import { useRecipeSearch } from "@/hooks/useRecipeSearch";
import type {
  SearchableRecipe,
  RecipeSearchParams,
} from "@shared/types/recipe-search";
import {
  SearchFilterSheet,
  type SearchFilters,
} from "@/components/meal-plan/SearchFilterSheet";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
```

In the component, add state for advanced filters:

```ts
const [advancedFilters, setAdvancedFilters] = useState<SearchFilters>({
  sort: "relevance",
  maxPrepTime: undefined,
  maxCalories: undefined,
  minProtein: undefined,
  source: "all",
});
const [activeDifficulty, setActiveDifficulty] = useState<string | undefined>();
const [pantryMode, setPantryMode] = useState(false);
const [ingredientTags, setIngredientTags] = useState<string[]>([]);
const filterSheetRef = React.useRef<BottomSheetModal>(null);
```

- [ ] **Step 2: Replace data fetching with useRecipeSearch**

Replace the `browseParams` + `useUnifiedRecipes` + `useCatalogSearch` block with:

```ts
const searchParams: RecipeSearchParams | null = useMemo(
  () => ({
    q: debouncedQuery || undefined,
    cuisine: activeCuisine,
    diet: activeDiet,
    difficulty: activeDifficulty,
    pantry: pantryMode || undefined,
    ingredients:
      ingredientTags.length > 0 ? ingredientTags.join(",") : undefined,
    ...advancedFilters,
    // Only include defined filters
    maxPrepTime: advancedFilters.maxPrepTime,
    maxCalories: advancedFilters.maxCalories,
    minProtein: advancedFilters.minProtein,
  }),
  [
    debouncedQuery,
    activeCuisine,
    activeDiet,
    activeDifficulty,
    pantryMode,
    ingredientTags,
    advancedFilters,
  ],
);

const { data: searchData, isLoading } = useRecipeSearch(searchParams);
```

- [ ] **Step 3: Replace allRecipes merge logic**

Replace the `allRecipes` useMemo that merges community + personal with:

```ts
const allRecipes = useMemo(() => searchData?.results ?? [], [searchData]);
```

Update `renderItem` to work with `SearchableRecipe` instead of `UnifiedRecipeItem`. The card component will need adjustments to accept `SearchableRecipe` items.

- [ ] **Step 4: Update the filter chip row**

Add difficulty chips, pantry toggle, quick meals shortcut, ingredient search chip, and filter icon button. Replace the existing `<ScrollView horizontal>` filter row with the expanded version that includes:

```tsx
{
  /* Difficulty presets */
}
{
  ["Easy", "Medium", "Hard"].map((d) => (
    <Chip
      key={d}
      label={d}
      variant="filter"
      selected={activeDifficulty === d.toLowerCase()}
      onPress={() => {
        haptics.selection();
        setActiveDifficulty((prev) =>
          prev === d.toLowerCase() ? undefined : d.toLowerCase(),
        );
      }}
      accessibilityLabel={`Filter by ${d} difficulty`}
    />
  ));
}

{
  /* Pantry toggle */
}
<Chip
  label="From my pantry"
  variant="filter"
  selected={pantryMode}
  onPress={() => {
    haptics.selection();
    setPantryMode((prev) => !prev);
  }}
  accessibilityLabel="Filter recipes by pantry items"
/>;

{
  /* Quick meals shortcut */
}
<Chip
  label="Quick meals"
  variant="filter"
  selected={advancedFilters.maxPrepTime === 30}
  onPress={() => {
    haptics.selection();
    setAdvancedFilters((prev) => ({
      ...prev,
      maxPrepTime: prev.maxPrepTime === 30 ? undefined : 30,
    }));
  }}
  accessibilityLabel="Filter quick meals under 30 minutes"
/>;

{
  /* Filter icon button */
}
<Pressable
  onPress={() => filterSheetRef.current?.present()}
  style={[
    styles.filterIconButton,
    { borderColor: withOpacity(theme.text, 0.15) },
  ]}
  accessibilityRole="button"
  accessibilityLabel={`Advanced filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}
>
  <Feather name="sliders" size={16} color={theme.link} />
  {activeFilterCount > 0 && (
    <View style={[styles.filterBadge, { backgroundColor: theme.link }]}>
      <ThemedText style={[styles.filterBadgeText, { color: theme.buttonText }]}>
        {activeFilterCount}
      </ThemedText>
    </View>
  )}
</Pressable>;
```

- [ ] **Step 5: Add the bottom sheet modal**

At the end of the component return, before the closing `</View>`:

```tsx
<BottomSheetModal
  ref={filterSheetRef}
  snapPoints={["70%"]}
  backdropComponent={(props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
  )}
  backgroundStyle={{ backgroundColor: theme.backgroundRoot }}
  handleIndicatorStyle={{ backgroundColor: withOpacity(theme.text, 0.3) }}
>
  <BottomSheetView>
    <SearchFilterSheet
      filters={advancedFilters}
      onFiltersChange={setAdvancedFilters}
      onReset={() => {
        setAdvancedFilters({
          sort: "relevance",
          maxPrepTime: undefined,
          maxCalories: undefined,
          minProtein: undefined,
          source: "all",
        });
      }}
      activeFilterCount={activeFilterCount}
    />
  </BottomSheetView>
</BottomSheetModal>
```

- [ ] **Step 6: Remove the Spoonacular-specific code**

Remove the `showSpoonacular` state, `spoonacularParams`, `useCatalogSearch` call, `SpoonacularResults` component usage, `SearchOnlineButton` usage, and the footer that renders Spoonacular results separately. Spoonacular is now integrated via the search endpoint (when implemented server-side in a future enhancement).

Remove these:

- `const [showSpoonacular, setShowSpoonacular] = useState(false);`
- The `spoonacularParams` useMemo
- The `useCatalogSearch` call
- The `renderFooter` callback that shows `SpoonacularResults`
- The `SearchOnlineButton` in the empty state

- [ ] **Step 7: Add source badge to recipe cards**

In the `UnifiedRecipeCard` (or its replacement), add a small badge showing the source:

```tsx
{
  /* Source badge */
}
<View
  style={[
    styles.sourceBadge,
    { backgroundColor: withOpacity(theme.text, 0.06) },
  ]}
>
  <ThemedText style={[styles.sourceBadgeText, { color: theme.textSecondary }]}>
    {item.source === "personal"
      ? "My Recipe"
      : item.source === "community"
        ? "Community"
        : "Online"}
  </ThemedText>
</View>;
```

- [ ] **Step 8: Add missing styles**

```ts
filterIconButton: {
  width: 36,
  height: 36,
  borderRadius: 18,
  borderWidth: 1,
  alignItems: "center",
  justifyContent: "center",
},
filterBadge: {
  position: "absolute",
  top: -4,
  right: -4,
  width: 16,
  height: 16,
  borderRadius: 8,
  alignItems: "center",
  justifyContent: "center",
},
filterBadgeText: {
  fontSize: 10,
  fontFamily: FontFamily.semiBold,
},
sourceBadge: {
  paddingHorizontal: Spacing.xs,
  paddingVertical: 2,
  borderRadius: BorderRadius.chip,
  alignSelf: "flex-start",
},
sourceBadgeText: {
  fontSize: 10,
  fontFamily: FontFamily.medium,
},
```

- [ ] **Step 9: Run lint and type check**

```bash
npm run lint && npm run check:types
```

Expected: no new errors

- [ ] **Step 10: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass

- [ ] **Step 11: Commit**

```bash
git add client/screens/meal-plan/RecipeBrowserScreen.tsx
git commit -m "feat(search): integrate unified search into RecipeBrowserScreen"
```

---

### Task 12: Run full verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass

- [ ] **Step 2: Run linting**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 3: Run type checking**

```bash
npm run check:types
```

Expected: no errors

- [ ] **Step 4: Verify search endpoint manually**

Start the dev server and test:

```bash
npm run server:dev &
sleep 3
# Basic search
curl -s -H "Authorization: Bearer <token>" "http://localhost:3000/api/recipes/search?q=chicken" | jq '.total'
# Filter search
curl -s -H "Authorization: Bearer <token>" "http://localhost:3000/api/recipes/search?cuisine=Italian&sort=newest" | jq '.results | length'
# Empty search (all results)
curl -s -H "Authorization: Bearer <token>" "http://localhost:3000/api/recipes/search" | jq '.total'
kill %1
```

Expected: responses contain `results` array, `total` count, proper pagination fields

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(search): address verification findings"
```

---

## Follow-Up Work (Not in This Plan)

These items are referenced in the spec but deliberately deferred to keep this plan focused:

1. **Spoonacular inline integration** — The `source` filter and `SearchableRecipe` type support Spoonacular, but the search service doesn't yet query Spoonacular in parallel. This requires calling `searchCatalogRecipes`, normalizing results to `SearchableRecipe`, and caching them in the index. Add this once the local search is stable.

2. **Backward compat wrappers** — The spec says `GET /api/recipes/browse` should delegate to the new search service. The old endpoint still works as-is during migration. Once the client is fully migrated (Task 11), the old endpoint can be updated to delegate to `searchRecipes()` or removed in a cleanup pass.

3. **Spoonacular normalizer** — A `spoonacularToSearchable()` function mapping Spoonacular detail responses to `SearchableRecipe`. Needed when Spoonacular inline integration is added.

4. **CocoaPods rebuild** — The `@react-native-community/slider` package is a native module. After `npm install`, run `cd ios && pod install && cd ..` before building with `npx expo run:ios`. This is only needed for iOS simulator/device testing, not for unit tests or server work.
