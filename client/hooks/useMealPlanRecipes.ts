import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { MealPlanRecipe, RecipeIngredient } from "@shared/schema";

type RecipeWithIngredients = MealPlanRecipe & {
  ingredients: RecipeIngredient[];
};

export function useUserMealPlanRecipes() {
  return useQuery<MealPlanRecipe[]>({
    queryKey: ["/api/meal-plan/recipes"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/meal-plan/recipes");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
}

export function useMealPlanRecipeDetail(recipeId: number) {
  return useQuery<RecipeWithIngredients>({
    queryKey: ["/api/meal-plan/recipes", recipeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meal-plan/recipes/${recipeId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: recipeId > 0,
  });
}

export function useCreateMealPlanRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recipe: {
      title: string;
      description?: string | null;
      cuisine?: string | null;
      difficulty?: string | null;
      servings?: number;
      prepTimeMinutes?: number | null;
      cookTimeMinutes?: number | null;
      instructions?: string | null;
      dietTags?: string[];
      caloriesPerServing?: string | number | null;
      proteinPerServing?: string | number | null;
      carbsPerServing?: string | number | null;
      fatPerServing?: string | number | null;
      ingredients?: {
        name: string;
        quantity?: string | number | null;
        unit?: string | null;
        category?: string;
      }[];
    }) => {
      const res = await apiRequest("POST", "/api/meal-plan/recipes", recipe);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json() as Promise<MealPlanRecipe>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plan/recipes"] });
    },
  });
}

export function useDeleteMealPlanRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/meal-plan/recipes/${id}`);
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plan/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plan"] });
    },
  });
}
