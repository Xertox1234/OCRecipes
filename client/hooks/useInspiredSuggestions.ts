import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { ApiError } from "@/lib/api-error";
import {
  listingResponseSchema,
  makeResponseSchema,
  type CreateListingBody,
  type Suggestion,
} from "@shared/schemas/inspired-recipes";

export function useCreateSuggestionListing() {
  return useMutation<Suggestion[], ApiError, CreateListingBody>({
    mutationFn: async (body) => {
      const res = await apiRequest("POST", "/api/inspired/suggestions", body);
      return listingResponseSchema.parse(await res.json()).suggestions;
    },
    meta: { silentError: true },
  });
}

async function waitForMadeRecipe(id: number): Promise<number | null> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await apiRequest("GET", `/api/inspired/suggestions?ids=${id}`);
    const made = listingResponseSchema.parse(await res.json()).suggestions[0]
      ?.madeRecipeId;
    if (made) return made;
  }
  return null;
}

export function useMakeSuggestion() {
  const queryClient = useQueryClient();
  return useMutation<{ recipeId: number }, ApiError, number>({
    mutationFn: async (id) => {
      let res: Response;
      try {
        res = await apiRequest("POST", `/api/inspired/suggestions/${id}/make`);
      } catch (error) {
        // 409: another tap is generating it — wait for that one to finish.
        if ((error as ApiError).status !== 409) throw error;
        const made = await waitForMadeRecipe(id);
        if (made === null) throw error;
        return { recipeId: made };
      }
      return makeResponseSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/recipes/browse"] });
    },
    meta: { silentError: true },
  });
}
