import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { cookCards, type CookCard } from "@/lib/cook-mode-utils";
import type {
  CommunityRecipe,
  MealPlanRecipe,
  RecipeIngredient,
} from "@shared/schema";

type MealPlanRecipeWithIngredients = MealPlanRecipe & {
  ingredients: RecipeIngredient[];
};

interface CookIngredient {
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
}

export interface CookRecipe {
  title: string | null;
  /** Empty while loading, on an error, and for a recipe with no steps. */
  cards: CookCard[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * The recipe cook mode pages through. Reads the same two endpoints, under
 * the same query keys, as the recipe page, so a recipe opened from there is
 * already in the cache.
 */
export function useCookRecipe(
  recipeId: number,
  recipeType: "community" | "mealPlan",
): CookRecipe {
  const community = useQuery<CommunityRecipe>({
    queryKey: [`/api/recipes/${recipeId}`],
    enabled: recipeType === "community" && recipeId > 0,
  });
  const mealPlan = useQuery<MealPlanRecipeWithIngredients>({
    queryKey: ["/api/meal-plan/recipes", recipeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meal-plan/recipes/${recipeId}`);
      return res.json();
    },
    enabled: recipeType === "mealPlan" && recipeId > 0,
    // The screen shows its own error state (as the recipe page does).
    meta: { silentError: true },
  });

  const query = recipeType === "community" ? community : mealPlan;
  const communityData = community.data;
  const mealPlanData = mealPlan.data;

  const cards = useMemo(() => {
    if (recipeType === "mealPlan") {
      if (!mealPlanData) return [];
      return cookCards({
        ingredients: mealPlanData.ingredients ?? [],
        instructions: mealPlanData.instructions ?? [],
      });
    }
    if (!communityData) return [];
    return cookCards({
      ingredients: (communityData.ingredients ?? []) as CookIngredient[],
      instructions: communityData.instructions ?? [],
      details: (communityData.instructionDetails as (string | null)[]) ?? [],
    });
  }, [recipeType, communityData, mealPlanData]);

  return {
    title: query.data?.title ?? null,
    cards,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
