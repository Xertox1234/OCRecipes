# Recipe Search Overhaul

**Date:** 2026-04-13
**Status:** Draft
**Approach:** Application-layer search engine (MiniSearch) with unified index

## Overview

Replace the current basic ILIKE substring search with a comprehensive search system powered by an in-memory search library (MiniSearch). All recipe sources — personal, community, and Spoonacular — are normalized into a single `SearchableRecipe` document type and indexed together, enabling fuzzy text search, ingredient-based search, pantry-aware filtering, and rich filter/sort options across a unified result set.

## Context

### Current State

- Text search uses PostgreSQL `ILIKE '%pattern%'` — no relevance ranking, no typo tolerance
- Trigram GIN indexes exist on `title`/`description` but aren't leveraged for scoring
- Community and personal recipes are queried separately and merged in application code
- Spoonacular is a separate "Search Online" fallback behind a button, not inline
- No ingredient-based search, no sorting options, no calorie/time range filtering
- Existing data normalization layer (`server/lib/recipe-normalization.ts`) standardizes titles, units, difficulty, and ingredient formatting on ingestion — the search index benefits from this clean data

### Goals

- Unified search across all recipe sources with consistent behavior
- Fuzzy text search with typo tolerance and relevance ranking
- Ingredient-based search (manual + pantry-aware)
- Rich filtering: cuisine, diet, difficulty, prep time, calories, macros
- Multiple sort modes: relevance, newest, quickest, lowest calories, most popular
- Spoonacular results inline alongside local results
- No new infrastructure — in-memory index on the Express server

## Unified Document Type

Every recipe is normalized to this shape before indexing:

```ts
interface SearchableRecipe {
  id: string; // "local:42", "community:17", "spoonacular:654321"
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
```

## Search Index Configuration

**Library:** MiniSearch (~7KB, zero dependencies)

- **Searchable fields:** `title` (boost 3x), `ingredients` (boost 2x), `description` (boost 1x), `cuisine`, `dietTags`
- **Fuzzy matching:** Edit distance of 2 (handles "chiken" -> "chicken")
- **Prefix search:** Enabled (typing "chic" matches "chicken")
- **ID field:** `id`

## Search API

### Endpoint

```
GET /api/recipes/search
```

Authenticated. Rate limited (same as current `instructionsRateLimit`).

### Query Parameters

| Param         | Type    | Default       | Constraints                                    | Description                                        |
| ------------- | ------- | ------------- | ---------------------------------------------- | -------------------------------------------------- |
| `q`           | string  | —             | max 200 chars                                  | Text search across title, ingredients, description |
| `ingredients` | string  | —             | comma-separated, max 20 items                  | Filter to recipes containing these ingredients     |
| `pantry`      | boolean | `false`       | —                                              | Use user's pantry items as ingredient filter       |
| `cuisine`     | string  | —             | max 50 chars                                   | Cuisine filter                                     |
| `diet`        | string  | —             | max 50 chars                                   | Diet filter                                        |
| `mealType`    | string  | —             | breakfast/lunch/dinner/snack                   | Meal type filter                                   |
| `difficulty`  | string  | —             | easy/medium/hard                               | Difficulty filter                                  |
| `maxPrepTime` | number  | —             | 1-480                                          | Max prep time in minutes                           |
| `maxCalories` | number  | —             | 1-5000                                         | Max calories per serving                           |
| `minProtein`  | number  | —             | 0-500                                          | Min protein per serving (grams)                    |
| `sort`        | string  | `"relevance"` | relevance/newest/quickest/calories_asc/popular | Sort order                                         |
| `source`      | string  | `"all"`       | all/personal/community/spoonacular             | Filter by recipe source                            |
| `limit`       | number  | 20            | 1-50                                           | Results per page                                   |
| `offset`      | number  | 0             | >= 0                                           | Pagination offset                                  |

### Response Shape

```ts
{
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

### Search Execution Flow

1. If `q` is provided, MiniSearch executes a fuzzy+prefix text search, returning relevance-scored results
2. If `ingredients` is provided (or `pantry=true` which resolves to ingredient names), MiniSearch runs a field-scoped search on the `ingredients` field
3. Post-search filters (cuisine, diet, difficulty, maxPrepTime, maxCalories, minProtein, mealType, source) applied on the scored results
4. Results sorted by `sort` param (relevance uses MiniSearch scores; others sort by the respective field)
5. Pagination applied (`offset` + `limit`)
6. When `source` includes Spoonacular (`all` or `spoonacular`), Spoonacular is queried in parallel and results are merged before filtering/sorting

### Backward Compatibility

Existing endpoints remain as thin wrappers:

- `GET /api/recipes/browse` delegates to search service with mapped params
- `GET /api/meal-plan/catalog/search` delegates with `source=spoonacular`

## Index Lifecycle

### Initialization (server startup)

1. `initSearchIndex()` loads all `mealPlanRecipes` and `communityRecipes` from DB
2. Each recipe is mapped through source-specific `toSearchableRecipe()` normalizer
3. Documents are bulk-added to the MiniSearch instance
4. Index is ready for queries

### Incremental Updates

Called directly from existing storage functions (thin hooks, no pub/sub):

- Recipe created -> `addToIndex(recipe)`
- Recipe updated -> `removeFromIndex(id)` then `addToIndex(recipe)`
- Recipe deleted -> `removeFromIndex(id)`

### Spoonacular Caching

- Spoonacular results are normalized and added to the index when fetched
- Marked with a 1-hour TTL (matching existing LRU cache behavior)
- Subsequent searches find cached Spoonacular recipes in the index without another API call
- Stale entries are evicted on next index access after TTL expiry

## Client-Side UI

### RecipeBrowserScreen Changes

**Search bar** (updated):

- Keeps existing 300ms debounce
- Rotating placeholder hints: "Search recipes...", "Try 'chicken parmesan'", "Search by ingredient..."

**Filter chip row** (expanded):

- Existing: Cuisine chips, Diet chips, "Safe for me" toggle
- New: Difficulty chips (Easy, Medium, Hard)
- New: "From my pantry" toggle chip — sets `pantry=true`
- New: "Quick meals" chip — shortcut for `maxPrepTime=30`

**Advanced filters bottom sheet** (new):

- Triggered by filter icon at end of chip row
- Prep time range slider (0-120 min)
- Calorie range slider (0-1000+)
- Protein minimum slider (0-60g)
- Sort picker: Relevance, Newest, Quickest, Lowest Calories, Most Popular
- Source picker: All, My Recipes, Community, Online
- "Reset filters" button
- Applied filter count shown as badge on filter icon

**Ingredient search mode** (new):

- Activated by "+ Ingredients" chip
- Multi-select tag input for typing/adding ingredient names
- Combines with text search (`q` + `ingredients` together)

**Result cards** (updated):

- Existing card layout preserved
- New: subtle source badge ("My Recipe", "Community", or Spoonacular icon)
- Spoonacular results appear inline in the same FlatList
- Separate "Search Online" button removed

**Empty state** (updated):

- Existing empty state design preserved
- "Search Online" button removed (Spoonacular is already included)

### New Hook

`useRecipeSearch()` in `client/hooks/useRecipeSearch.ts`:

- Wraps TanStack Query for the new `/api/recipes/search` endpoint
- Manages filter state, debounced query, pagination
- Returns `{ results, total, isLoading, filters, setFilter, resetFilters, loadMore }`

## File Structure

### New Files

```
server/services/recipe-search.ts           — index lifecycle, search execution, result merging
client/hooks/useRecipeSearch.ts            — TanStack Query hook for search endpoint
client/components/meal-plan/SearchFilterSheet.tsx — advanced filters bottom sheet
```

### Modified Files

```
server/routes/recipes.ts                   — new /api/recipes/search endpoint, old endpoints delegate
server/storage/meal-plans.ts               — add index hooks to recipe CRUD functions
server/storage/community.ts                — add index hooks to community recipe CRUD
client/screens/meal-plan/RecipeBrowserScreen.tsx — new filter UI, ingredient search, unified results
shared/types/recipe-catalog.ts             — add SearchableRecipe, SearchParams, SearchResponse types (shared between client and server)
```

## Testing

### Unit Tests

`server/services/__tests__/recipe-search.test.ts`:

- Index initialization with mock recipes from all three sources
- Text search: exact match, partial/prefix, fuzzy (typo tolerance)
- Ingredient search: single, multiple, pantry mode
- Filter combinations: cuisine + diet, maxPrepTime + maxCalories, etc.
- All 5 sort modes produce correct ordering
- Spoonacular response normalization to SearchableRecipe
- Incremental updates: add/update/remove reflected in results
- Edge cases: empty query, no results, special characters

`server/lib/__tests__/recipe-search-types.test.ts`:

- `toSearchableRecipe()` for each source (personal, community, Spoonacular)
- Null/missing field handling

`server/routes/__tests__/recipes.test.ts`:

- `/api/recipes/search` with various param combos
- Backward compat: `/api/recipes/browse` still works
- Input validation: bad params rejected, limits enforced

`client/hooks/__tests__/useRecipeSearch.test.ts`:

- Debouncing behavior
- Filter state management
- Pagination

## Migration Strategy

Additive rollout — no breaking changes at any phase:

1. **Phase 1 — Backend:** Add `recipe-search.ts` service, `/api/recipes/search` endpoint, index hooks in storage. Existing endpoints untouched.
2. **Phase 2 — Client:** Update `RecipeBrowserScreen` to use new endpoint. Add filter sheet, ingredient search, pantry toggle. Remove old endpoint calls.
3. **Phase 3 — Cleanup:** Remove dead browse/catalog split code. Deprecate old endpoints.

No database migrations required. The search index is purely in-memory, derived from existing data.

## Dependencies

- `minisearch` — npm package (~7KB, zero dependencies, MIT licensed)

No other new dependencies.
