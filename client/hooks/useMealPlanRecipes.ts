import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type {
  MealPlanRecipe,
  RecipeIngredient,
  CommunityRecipe,
} from "@shared/schema";
import type { ParsePageParams } from "@shared/schemas/recipe";
import type { ImportedRecipeData } from "@shared/types/recipe-import";

type RecipeWithIngredients = MealPlanRecipe & {
  ingredients: RecipeIngredient[];
};

type UnifiedRecipesResponse = {
  community: CommunityRecipe[];
  personal: MealPlanRecipe[];
  frequent: MealPlanRecipe[];
};

export function useUnifiedRecipes(params?: {
  query?: string;
  cuisine?: string;
  diet?: string;
  mealType?: string;
}) {
  return useQuery<UnifiedRecipesResponse>({
    queryKey: ["/api/recipes/browse", params ?? {}],
    queryFn: async () => {
      const qs = params
        ? new URLSearchParams(
            Object.entries(params)
              .filter(([, v]) => v !== undefined && v !== "")
              .map(([k, v]) => [k, String(v)]),
          ).toString()
        : "";
      const url = qs ? `/api/recipes/browse?${qs}` : "/api/recipes/browse";
      const res = await apiRequest("GET", url);
      return res.json();
    },
    // Each search term is its own key; show the last results while the next
    // term loads instead of dropping to the skeleton (perf audit L3).
    placeholderData: keepPreviousData,
  });
}

export function useMealPlanRecipeDetail(recipeId: number) {
  return useQuery<RecipeWithIngredients>({
    queryKey: ["/api/meal-plan/recipes", recipeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meal-plan/recipes/${recipeId}`);
      return res.json();
    },
    enabled: recipeId > 0,
  });
}

export type CreateMealPlanRecipeInput = {
  title: string;
  description?: string | null;
  cuisine?: string | null;
  difficulty?: string | null;
  servings?: number;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  instructions?: string[] | null;
  dietTags?: string[];
  sourceType?:
    | "user_created"
    | "quick_entry"
    | "ai_suggestion"
    | "photo_import";
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
  sourceCommunityRecipeId?: number;
};

export function useCreateMealPlanRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recipe: CreateMealPlanRecipeInput) => {
      const res = await apiRequest("POST", "/api/meal-plan/recipes", recipe);
      return res.json() as Promise<MealPlanRecipe>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/meal-plan/recipes"],
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/recipes/browse"] });
    },
    // Every call site (MealPlanHomeScreen, WizardShell, SimpleEntrySheet)
    // already toasts/alerts on failure via a shared try/catch.
    meta: { silentError: true },
  });
}

export function useImportRecipeFromUrl() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (url: string): Promise<MealPlanRecipe> => {
      const res = await apiRequest(
        "POST",
        "/api/meal-plan/recipes/import-url",
        {
          url,
        },
      );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/meal-plan/recipes"],
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/recipes/browse"] });
    },
  });
}

export function useParseRecipeFromPage() {
  return useMutation({
    mutationFn: async ({
      url,
      ldJson,
    }: ParsePageParams): Promise<ImportedRecipeData> => {
      const res = await apiRequest(
        "POST",
        "/api/meal-plan/recipes/parse-page",
        { url, ldJson },
      );
      return res.json();
    },
    // Both call sites show their own failure UI: RecipeImportScreen falls back
    // to a sign-in panel, RecipeImportBrowserScreen shows an inline message.
    meta: { silentError: true },
  });
}

export function useParseRecipeFromUrl() {
  return useMutation({
    mutationFn: async (url: string): Promise<ImportedRecipeData> => {
      const res = await apiRequest("POST", "/api/meal-plan/recipes/parse-url", {
        url,
      });
      return res.json();
    },
    // Its one call site (RecipeImportScreen) already shows an inline error
    // + retry on failure via its own try/catch.
    meta: { silentError: true },
  });
}
