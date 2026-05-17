import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type {
  SearchableRecipe,
  RecipeSearchParams,
} from "@shared/types/recipe-search";

// Spoonacular's `number` param caps at 50 (see catalogSearchSchema).
const PAGE_SIZE = 20;

/** Raw item shape from GET /api/meal-plan/catalog/search. */
interface CatalogSearchResult {
  id: number;
  title: string;
  image?: string;
  imageType?: string;
  readyInMinutes?: number;
}

/** Raw response shape from GET /api/meal-plan/catalog/search. */
interface CatalogSearchResponse {
  results: CatalogSearchResult[];
  offset: number;
  number: number;
  totalResults: number;
}

/**
 * Translates the unified recipe-search params into the catalog endpoint's
 * query string. Only the filters Spoonacular supports are forwarded — local
 * filters (minProtein, maxCalories, pantry, curatedOnly, difficulty, sort)
 * are dropped rather than sent, since the catalog endpoint would 400 on them.
 */
function buildCatalogQueryString(
  params: RecipeSearchParams,
  offset: number,
): string {
  const entries: [string, string][] = [
    ["query", params.q ?? ""],
    ["number", String(PAGE_SIZE)],
    ["offset", String(offset)],
  ];
  if (params.cuisine) entries.push(["cuisine", params.cuisine]);
  if (params.diet) entries.push(["diet", params.diet]);
  if (params.mealType) entries.push(["type", params.mealType]);
  if (params.maxPrepTime !== undefined) {
    entries.push(["maxReadyTime", String(params.maxPrepTime)]);
  }
  return new URLSearchParams(entries).toString();
}

/** Maps a raw catalog result into the shared SearchableRecipe shape. */
function toSearchableRecipe(item: CatalogSearchResult): SearchableRecipe {
  return {
    id: `spoonacular:${item.id}`,
    source: "spoonacular",
    userId: null,
    title: item.title,
    description: null,
    ingredients: [],
    cuisine: null,
    dietTags: [],
    mealTypes: [],
    difficulty: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: item.readyInMinutes ?? null,
    caloriesPerServing: null,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    servings: null,
    imageUrl: item.image ?? null,
    sourceUrl: null,
    createdAt: null,
    isCanonical: false,
  };
}

/**
 * Searches the online Spoonacular catalog via GET /api/meal-plan/catalog/search.
 *
 * The endpoint is premium-gated, rate-limited, and quota-aware server-side.
 * Pass `enabled: false` (via a null `params`) for free users or when the
 * search query is empty — the catalog endpoint rejects blank queries.
 *
 * Returns the same `{ data, isLoading, loadMore, isFetchingNextPage }` shape
 * as `useRecipeSearch` so the recipe browser can swap sources transparently.
 */
export function useCatalogSearch(
  params: RecipeSearchParams | null,
  enabled: boolean,
) {
  const query = useInfiniteQuery<CatalogSearchResponse>({
    queryKey: ["/api/meal-plan/catalog/search", params ?? {}],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const qs = buildCatalogQueryString(params!, pageParam as number);
      const res = await apiRequest(
        "GET",
        `/api/meal-plan/catalog/search?${qs}`,
      );
      return res.json();
    },
    getNextPageParam: (lastPage) => {
      const loadedCount = lastPage.offset + lastPage.results.length;
      if (loadedCount < lastPage.totalResults) {
        return loadedCount;
      }
      return undefined;
    },
    enabled: enabled && params !== null,
  });

  const results: SearchableRecipe[] = useMemo(
    () =>
      query.data?.pages.flatMap((page) =>
        page.results.map(toSearchableRecipe),
      ) ?? [],
    [query.data],
  );

  const total = query.data?.pages[0]?.totalResults ?? 0;

  return {
    ...query,
    data: query.data ? { results, total } : undefined,
    loadMore: query.hasNextPage ? query.fetchNextPage : undefined,
  };
}
