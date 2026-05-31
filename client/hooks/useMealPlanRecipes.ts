import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import type {
  MealPlanRecipe,
  RecipeIngredient,
  CommunityRecipe,
} from "@shared/schema";
import type { ImportedRecipeData } from "@shared/types/recipe-import";

/**
 * Throw a code-carrying ApiError from a status-only query failure.
 *
 * In production `apiRequest` already throws an `ApiError` (with the server's
 * parsed `code`) before this runs, so this is exercised mainly by tests that
 * mock `apiRequest`; throwing an `ApiError` here keeps the test and production
 * error contracts aligned so screens can branch on `.code` instead of a fragile
 * status-string message comparison.
 */
function throwStatusError(status: number): never {
  const code = status === 404 ? ErrorCode.NOT_FOUND : ErrorCode.INTERNAL_ERROR;
  throw new ApiError(status === 404 ? "Not found" : "Request failed", code);
}

type RecipeWithIngredients = MealPlanRecipe & {
  ingredients: RecipeIngredient[];
};

export type CatalogSearchResult = {
  id: number;
  title: string;
  image?: string;
  readyInMinutes?: number;
};

type CatalogSearchResponse = {
  results: CatalogSearchResult[];
  offset: number;
  number: number;
  totalResults: number;
};

export type CatalogSearchParams = {
  query: string;
  cuisine?: string;
  diet?: string;
  type?: string;
  maxReadyTime?: number;
  offset?: number;
  number?: number;
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
  const qs = params
    ? new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";

  return useQuery<UnifiedRecipesResponse>({
    queryKey: ["/api/recipes/browse", params ?? {}],
    queryFn: async () => {
      const url = qs ? `/api/recipes/browse?${qs}` : "/api/recipes/browse";
      const res = await apiRequest("GET", url);
      if (!res.ok) throwStatusError(res.status);
      return res.json();
    },
  });
}

export function useMealPlanRecipeDetail(recipeId: number) {
  return useQuery<RecipeWithIngredients>({
    queryKey: ["/api/meal-plan/recipes", recipeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meal-plan/recipes/${recipeId}`);
      if (!res.ok) throwStatusError(res.status);
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
    }) => {
      const res = await apiRequest("POST", "/api/meal-plan/recipes", recipe);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json() as Promise<MealPlanRecipe>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/meal-plan/recipes"],
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/recipes/browse"] });
    },
  });
}

export function useCatalogSearch(params: CatalogSearchParams | null) {
  const qs = params
    ? new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";

  return useQuery<CatalogSearchResponse>({
    queryKey: ["/api/meal-plan/catalog/search", params],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/meal-plan/catalog/search?${qs}`,
      );
      if (!res.ok) throwStatusError(res.status);
      return res.json();
    },
    enabled: !!params && !!params.query,
  });
}

export function useSaveCatalogRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (spoonacularId: number): Promise<MealPlanRecipe> => {
      const res = await apiRequest(
        "POST",
        `/api/meal-plan/catalog/${spoonacularId}/save`,
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
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
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
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

export function useParseRecipeFromUrl() {
  return useMutation({
    mutationFn: async (url: string): Promise<ImportedRecipeData> => {
      const res = await apiRequest("POST", "/api/meal-plan/recipes/parse-url", {
        url,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
  });
}
