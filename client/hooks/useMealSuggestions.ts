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
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        const err = new Error(body.error || `${res.status}`);
        (err as Error & { code?: string }).code = body.code;
        throw err;
      }
      return res.json();
    },
  });
}
