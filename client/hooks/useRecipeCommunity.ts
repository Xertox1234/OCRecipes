import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/query-client";
import { applyTriedOptimistic } from "@/components/recipe-community-stats-utils";
import type {
  RecipeCommunityStats,
  RecipeVariantDto,
} from "@shared/types/recipe-community";

export function recipeStatsKey(recipeId: number) {
  return [`/api/recipes/${recipeId}/stats`] as const;
}

/**
 * Community stats for a public community recipe. Consumers render ONLY when
 * `isSuccess` — a failed refetch (e.g. the recipe went private → 404) keeps
 * stale `data` but flips `isSuccess` to false, which hides the UI.
 */
export function useRecipeCommunityStats(recipeId: number, enabled: boolean) {
  return useQuery<RecipeCommunityStats>({
    queryKey: recipeStatsKey(recipeId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/recipes/${recipeId}/stats`);
      return res.json();
    },
    enabled: enabled && recipeId > 0,
    retry: false,
    // Secondary UI: hides itself on error; never a global error toast.
    meta: { silentError: true },
  });
}

export function useSetRecipeTried(recipeId: number) {
  const queryClient = useQueryClient();
  const key = recipeStatsKey(recipeId);
  return useMutation<
    { tried: boolean; triedCount: number },
    Error,
    boolean,
    { previous: RecipeCommunityStats | undefined }
  >({
    mutationFn: async (tried) => {
      const res = await apiRequest(
        tried ? "PUT" : "DELETE",
        `/api/recipes/${recipeId}/tried`,
      );
      return res.json();
    },
    onMutate: async (tried) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RecipeCommunityStats>(key);
      if (previous) {
        queryClient.setQueryData(key, applyTriedOptimistic(previous, tried));
      }
      return { previous };
    },
    onError: (_error, _tried, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
    // The bar shows its own "Couldn't save" toast.
    meta: { silentError: true },
  });
}

export function useRecipeVariants(recipeId: number) {
  return useQuery<{ variants: RecipeVariantDto[] }>({
    queryKey: [`/api/recipes/${recipeId}/variants`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/recipes/${recipeId}/variants`);
      return res.json();
    },
    enabled: recipeId > 0,
    meta: { silentError: true },
  });
}
