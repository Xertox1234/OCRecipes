import { useQuery } from "@tanstack/react-query";
import type { CommunityRecipe } from "@shared/schema";

interface CuratedRecipesResponse {
  recipes: CommunityRecipe[];
}

export function useCuratedRecipes() {
  return useQuery<CuratedRecipesResponse>({
    queryKey: ["/api/curated-recipes"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
