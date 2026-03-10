import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export interface GeneratedMealIngredient {
  name: string;
  quantity: string;
  unit: string;
}

export interface GeneratedMeal {
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  title: string;
  description: string;
  servings: number;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  difficulty: "Easy" | "Medium" | "Hard";
  ingredients: GeneratedMealIngredient[];
  instructions: string;
  dietTags: string[];
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
}

export interface GeneratedDay {
  dayNumber: number;
  meals: GeneratedMeal[];
}

export interface GeneratedMealPlan {
  days: GeneratedDay[];
}

interface GenerateInput {
  days: number;
  startDate: string;
}

interface SaveMealInput {
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  title: string;
  description?: string;
  servings: number;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  difficulty?: string;
  ingredients: {
    name: string;
    quantity?: string | null;
    unit?: string | null;
  }[];
  instructions?: string;
  dietTags?: string[];
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  plannedDate: string;
}

interface SaveResult {
  saved: number;
  items: { recipeId: number; mealPlanItemId: number }[];
}

export function useGenerateMealPlanFromPantry() {
  return useMutation<GeneratedMealPlan, Error, GenerateInput>({
    mutationFn: async (input) => {
      const res = await apiRequest(
        "POST",
        "/api/meal-plan/generate-from-pantry",
        input,
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Meal plan generation failed: ${res.status}`,
        );
      }
      return res.json();
    },
  });
}

export function useSaveGeneratedMealPlan() {
  const queryClient = useQueryClient();

  return useMutation<SaveResult, Error, SaveMealInput[]>({
    mutationFn: async (meals) => {
      const res = await apiRequest("POST", "/api/meal-plan/save-generated", {
        meals,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Save failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meal-plan"] });
    },
  });
}
