import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type {
  SearchableRecipe,
  RecipeSearchParams,
  RecipeSearchResponse,
} from "@shared/types/recipe-search";

const PAGE_SIZE = 20;

function buildQueryString(params: RecipeSearchParams, offset: number): string {
  const entries = Object.entries({ ...params, limit: PAGE_SIZE, offset })
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)]);
  return new URLSearchParams(entries).toString();
}

export function useRecipeSearch(params: RecipeSearchParams | null) {
  const query = useInfiniteQuery<RecipeSearchResponse>({
    queryKey: ["/api/recipes/search", params ?? {}],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const qs = buildQueryString(params!, pageParam as number);
      const res = await apiRequest("GET", `/api/recipes/search?${qs}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce(
        (sum, page) => sum + page.results.length,
        0,
      );
      if (loadedCount < lastPage.total) {
        return loadedCount;
      }
      return undefined;
    },
    enabled: params !== null,
  });

  const results: SearchableRecipe[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.results) ?? [],
    [query.data],
  );

  const total = query.data?.pages[0]?.total ?? 0;

  return {
    ...query,
    data: query.data
      ? { results, total, query: query.data.pages[0]?.query }
      : undefined,
    loadMore: query.hasNextPage ? query.fetchNextPage : undefined,
  };
}
