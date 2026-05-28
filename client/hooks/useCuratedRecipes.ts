import { useQuery } from "@tanstack/react-query";
import type { CommunityRecipe } from "@shared/schema";

interface CuratedRecipesResponse {
  recipes: CommunityRecipe[];
}

export function useCuratedRecipes() {
  return useQuery<CuratedRecipesResponse>({
    queryKey: ["/api/curated-recipes"],
    staleTime: 5 * 60 * 1000, // 5 minutes
    // CuratedRecipeCarousel renders its own inline error + retry, so suppress
    // the global error toast for this query to avoid double-reporting.
    meta: { silentError: true },
  });
}
