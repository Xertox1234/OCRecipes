import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { ImportedRecipeData } from "@shared/types/recipe-import";

export function useRecipeGenerate() {
  return useMutation({
    mutationFn: async (prompt: string): Promise<ImportedRecipeData> => {
      const res = await apiRequest("POST", "/api/meal-plan/recipes/generate", {
        prompt,
      });
      return res.json();
    },
  });
}
