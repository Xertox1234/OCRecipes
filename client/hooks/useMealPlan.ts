import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { MealPlanItem, MealPlanRecipe, ScannedItem } from "@shared/schema";

type MealPlanItemWithRelations = MealPlanItem & {
  recipe: MealPlanRecipe | null;
  scannedItem: ScannedItem | null;
};

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
      displayOrder?: number;
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
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plan"] });
    },
  });
}

export function useUpdateMealPlanItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: number;
      plannedDate?: string;
      mealType?: string;
      displayOrder?: number;
      servings?: string | number;
    }) => {
      const res = await apiRequest(
        "PUT",
        `/api/meal-plan/items/${id}`,
        updates,
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json() as Promise<MealPlanItem>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plan"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plan"] });
    },
  });
}
