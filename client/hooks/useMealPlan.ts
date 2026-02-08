import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { MealPlanItem } from "@shared/schema";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";

/** Invalidate only meal-plan item queries, not recipes/catalog queries.
 *  Item queries use key ["/api/meal-plan", startDate, endDate] while recipe
 *  queries use ["/api/meal-plan/recipes", ...] so an exact match on the first
 *  element is sufficient to distinguish them. */
export function invalidateMealPlanItems(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && key[0] === "/api/meal-plan";
    },
  });
}

export function useMealPlanItems(startDate: string, endDate: string) {
  return useQuery<MealPlanItemWithRelations[]>({
    queryKey: ["/api/meal-plan", startDate, endDate],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/meal-plan?start=${startDate}&end=${endDate}`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!startDate && !!endDate,
  });
}

export function useAddMealPlanItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: {
      recipeId?: number | null;
      scannedItemId?: number | null;
      plannedDate: string;
      mealType: string;
      servings?: string | number;
    }) => {
      const res = await apiRequest("POST", "/api/meal-plan/items", item);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json() as Promise<MealPlanItem>;
    },
    onSuccess: () => {
      invalidateMealPlanItems(queryClient);
    },
  });
}

export function useRemoveMealPlanItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/meal-plan/items/${id}`);
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      invalidateMealPlanItems(queryClient);
    },
  });
}
