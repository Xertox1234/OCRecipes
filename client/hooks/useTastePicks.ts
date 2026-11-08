import { useCallback, useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  tastePickCandidatesResponseSchema,
  tastePicksResponseSchema,
} from "@shared/schemas/taste-picks";
import { apiRequest } from "@/lib/query-client";
import { logger } from "@/lib/logger";

export const TASTE_PICKS_PAGE_LIMIT = 30;

// Not QUERY_KEYS entries on purpose: App.tsx persists every QUERY_KEYS key.
const SAVED_PICKS_KEY = ["/api/taste-picks"] as const;

/**
 * Recipe candidates for the taste-picks grid, paged. `loadMore` is safe to
 * call from every `onEndReached`: it stops after a short page, and a call
 * while the next page is already loading joins that request instead of
 * restarting it (`cancelRefetch: false`). Its readers render their own
 * error + retry, so the query opts out of the global toast.
 */
export function useTastePickCandidates(dietType?: string | null) {
  const query = useInfiniteQuery({
    queryKey: ["/api/taste-picks/candidates", { dietType: dietType ?? null }],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        page: String(pageParam),
        limit: String(TASTE_PICKS_PAGE_LIMIT),
      });
      if (dietType) params.set("dietType", dietType);
      const res = await apiRequest(
        "GET",
        `/api/taste-picks/candidates?${params}`,
        undefined,
        { signal },
      );
      const parsed = tastePickCandidatesResponseSchema.safeParse(
        await res.json(),
      );
      if (!parsed.success) {
        logger.error("taste-pick candidates: invalid response", parsed.error);
        throw new Error("Invalid taste-pick candidates response");
      }
      return parsed.data;
    },
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.candidates.length === TASTE_PICKS_PAGE_LIMIT
        ? lastPageParam + 1
        : undefined,
    meta: { silentError: true },
  });

  const { data, hasNextPage, fetchNextPage } = query;
  const candidates = useMemo(
    () => data?.pages.flatMap((p) => p.candidates) ?? [],
    [data],
  );
  // Stable identity: it is handed straight to the list's onEndReached.
  const loadMore = useCallback(() => {
    if (hasNextPage) void fetchNextPage({ cancelRefetch: false });
  }, [hasNextPage, fetchNextPage]);

  return {
    candidates,
    loadMore,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** The user's saved taste picks, as recipe ids. */
export function useSavedTastePicks() {
  return useQuery({
    queryKey: SAVED_PICKS_KEY,
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", "/api/taste-picks", undefined, {
        signal,
      });
      const parsed = tastePicksResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        logger.error("taste picks: invalid response", parsed.error);
        throw new Error("Invalid taste picks response");
      }
      return parsed.data.picks.map((p) => p.recipeId);
    },
    meta: { silentError: true },
  });
}

/**
 * Saves the picks. Cuisine preferences follow the picks server-side, so the
 * Home carousel's "matches your cuisine preferences" labels are refreshed too.
 * The caller shows its own error copy.
 */
export function useSaveTastePicks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recipeIds: number[]) =>
      apiRequest("PUT", "/api/taste-picks", { recipeIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/carousel"] });
      void queryClient.invalidateQueries({
        queryKey: SAVED_PICKS_KEY,
        exact: true,
      });
    },
    meta: { silentError: true },
  });
}
