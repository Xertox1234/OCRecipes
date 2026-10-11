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
  const mutationKey = ["set-recipe-tried", recipeId];
  // Another tap on this recipe is still queued or in flight. The settling call
  // still counts as pending inside its own onError/onSettled, hence `> 1`.
  const laterTapPending = () => queryClient.isMutating({ mutationKey }) > 1;
  return useMutation<
    { tried: boolean; triedCount: number },
    Error,
    boolean,
    { previous: RecipeCommunityStats | undefined }
  >({
    mutationKey,
    // One request at a time per recipe, in tap order, so the server ends on
    // the last tap. onMutate (the optimistic update) still runs immediately.
    scope: { id: `set-recipe-tried-${recipeId}` },
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
    // While a later tap is pending, neither a rollback nor a refetch may
    // overwrite its optimistic state; the last tap to settle reconciles.
    onError: (_error, _tried, context) => {
      if (context?.previous && !laterTapPending()) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      if (!laterTapPending()) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
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
