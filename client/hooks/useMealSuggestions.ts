import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { MealSuggestionResponse } from "@shared/types/meal-suggestions";

export function useMealSuggestions() {
  return useMutation({
    mutationFn: async (params: {
      date: string;
      mealType: string;
    }): Promise<MealSuggestionResponse> => {
      const res = await apiRequest("POST", "/api/meal-plan/suggest", params);
      return res.json();
    },
  });
}
