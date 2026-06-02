import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import type { CarouselResponse } from "@shared/types/carousel";

const CAROUSEL_KEY = ["/api/carousel"];

export function useCarouselRecipes() {
  return useQuery<CarouselResponse>({
    queryKey: CAROUSEL_KEY,
    staleTime: 30 * 60 * 1000, // 30 minutes
    // RecipeCarousel renders its own inline error + retry, so suppress the
    // global error toast for this query to avoid double-reporting.
    meta: { silentError: true },
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/carousel", baseUrl);

      const headers: Record<string, string> = {
        "X-User-Hour": String(new Date().getHours()),
      };

      const token = await tokenStorage.get();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json() as Promise<CarouselResponse>;
    },
  });
}

export function useDismissCarouselRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { recipeId: number }) => {
      await apiRequest("POST", "/api/carousel/dismiss", params);
    },
    onMutate: async ({ recipeId }) => {
      // Optimistically remove the card from the carousel
      await queryClient.cancelQueries({ queryKey: CAROUSEL_KEY });
      const previous = queryClient.getQueryData<CarouselResponse>(CAROUSEL_KEY);

      queryClient.setQueryData<CarouselResponse>(CAROUSEL_KEY, (old) => {
        if (!old) return old;
        return {
          cards: old.cards.filter((c) => c.id !== recipeId),
        };
      });

      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Roll back on failure
      if (context?.previous) {
        queryClient.setQueryData(CAROUSEL_KEY, context.previous);
      }
    },
  });
}
