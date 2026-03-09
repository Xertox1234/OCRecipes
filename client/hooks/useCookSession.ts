import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { compressImage } from "@/lib/image-compression";
import type {
  CookingSessionResponse,
  CookSessionNutritionSummary,
  SubstitutionResult,
  IngredientEdit,
} from "@shared/types/cook-session";
import type { RecipeContent } from "../../server/services/recipe-generation";

// ============================================================================
// Session queries
// ============================================================================

export function useCookSessionQuery(sessionId: string | null) {
  return useQuery<CookingSessionResponse>({
    queryKey: ["/api/cooking/sessions", sessionId],
    enabled: !!sessionId,
    staleTime: 30_000,
  });
}

// ============================================================================
// Session mutations
// ============================================================================

export function useCreateCookSession() {
  return useMutation<CookingSessionResponse, Error>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/cooking/sessions");
      return res.json();
    },
  });
}

interface AddPhotoResult extends CookingSessionResponse {
  newDetections: number;
}

export function useAddCookPhoto(sessionId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<AddPhotoResult, Error, string>({
    mutationFn: async (photoUri: string) => {
      if (!sessionId) throw new Error("No active session");

      const compressed = await compressImage(photoUri, {
        maxWidth: 1536,
        maxHeight: 1536,
        quality: 0.85,
        targetSizeKB: 4500,
      });

      const formData = new FormData();
      formData.append("photo", {
        uri: compressed.uri,
        type: "image/jpeg",
        name: "ingredient.jpg",
      } as unknown as Blob);

      const token = await tokenStorage.get();
      const response = await fetch(
        `${getApiUrl()}/api/cooking/sessions/${sessionId}/photos`,
        {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: formData,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/cooking/sessions", sessionId],
      });
    },
  });
}

export function useEditIngredient(sessionId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<
    { ingredient: CookingSessionResponse["ingredients"][0] },
    Error,
    { ingredientId: string; updates: IngredientEdit }
  >({
    mutationFn: async ({ ingredientId, updates }) => {
      if (!sessionId) throw new Error("No active session");
      const res = await apiRequest(
        "PATCH",
        `/api/cooking/sessions/${sessionId}/ingredients/${ingredientId}`,
        updates,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/cooking/sessions", sessionId],
      });
    },
  });
}

export function useDeleteIngredient(sessionId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<
    { ingredients: CookingSessionResponse["ingredients"] },
    Error,
    string
  >({
    mutationFn: async (ingredientId: string) => {
      if (!sessionId) throw new Error("No active session");
      const res = await apiRequest(
        "DELETE",
        `/api/cooking/sessions/${sessionId}/ingredients/${ingredientId}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/cooking/sessions", sessionId],
      });
    },
  });
}

// ============================================================================
// Nutrition
// ============================================================================

export function useCookNutrition(sessionId: string | null) {
  return useMutation<
    CookSessionNutritionSummary,
    Error,
    { cookingMethod?: string }
  >({
    mutationFn: async (data) => {
      if (!sessionId) throw new Error("No active session");
      const res = await apiRequest(
        "POST",
        `/api/cooking/sessions/${sessionId}/nutrition`,
        data,
      );
      return res.json();
    },
  });
}

// ============================================================================
// Actions
// ============================================================================

export function useLogCookSession(sessionId: string | null) {
  return useMutation<unknown, Error, { mealType?: string; date?: string }>({
    mutationFn: async (data) => {
      if (!sessionId) throw new Error("No active session");
      const res = await apiRequest(
        "POST",
        `/api/cooking/sessions/${sessionId}/log`,
        data,
      );
      return res.json();
    },
  });
}

export function useCookRecipe(sessionId: string | null) {
  return useMutation<RecipeContent, Error>({
    mutationFn: async () => {
      if (!sessionId) throw new Error("No active session");
      const res = await apiRequest(
        "POST",
        `/api/cooking/sessions/${sessionId}/recipe`,
      );
      return res.json();
    },
  });
}

export function useCookSubstitutions(sessionId: string | null) {
  return useMutation<SubstitutionResult, Error, { ingredientIds?: string[] }>({
    mutationFn: async (data) => {
      if (!sessionId) throw new Error("No active session");
      const res = await apiRequest(
        "POST",
        `/api/cooking/sessions/${sessionId}/substitutions`,
        data,
      );
      return res.json();
    },
  });
}
