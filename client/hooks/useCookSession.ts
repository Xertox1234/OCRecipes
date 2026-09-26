import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { cleanupImage, compressImage } from "@/lib/image-compression";
import { invalidateFoodLogQueries } from "@/lib/food-log-invalidation";
import type {
  CookingSessionResponse,
  CookSessionNutritionSummary,
  SubstitutionResult,
  IngredientEdit,
  RecipeContent,
} from "@shared/types/cook-session";

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
    // Its one call site (CookSessionCaptureScreen.handleAnalyzePhoto) already
    // toasts on failure via its own try/catch.
    meta: { silentError: true },
  });
}

interface AddPhotoResult extends CookingSessionResponse {
  newDetections: number;
}

export interface AddCookPhotoVars {
  sessionId: string;
  photoUri: string;
}

/**
 * Uploads a photo to an existing cook session.
 *
 * `sessionId` is a mutation variable (not a hook arg) so callers that just
 * created the session via `ensureSession()` in the same microtask can pass
 * the fresh id through — a closure-captured `sessionId` would still be the
 * pre-`setState` value (`null`) and throw "No active session".
 * (H12 — 2026-04-18.)
 */
export function useAddCookPhoto() {
  const queryClient = useQueryClient();

  return useMutation<AddPhotoResult, Error, AddCookPhotoVars>({
    mutationFn: async ({ sessionId, photoUri }) => {
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

      try {
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
      } finally {
        await cleanupImage(compressed.uri);
      }
    },
    onSuccess: (_data, { sessionId }) => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/cooking/sessions", sessionId],
      });
    },
    // Its one call site (CookSessionCaptureScreen.handleAnalyzePhoto) already
    // toasts on failure via its own try/catch.
    meta: { silentError: true },
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
      void queryClient.invalidateQueries({
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
      void queryClient.invalidateQueries({
        queryKey: ["/api/cooking/sessions", sessionId],
      });
    },
  });
}

// ============================================================================
// Nutrition
// ============================================================================

/**
 * No opt-out (deliberate): this one mutation instance is driven from two
 * different call sites in CookSessionReviewScreen — `fetchNutrition()`
 * (visible inline error banner + retry) and `handlePreparationChange`
 * (no error handling at all). `meta` is fixed per `useMutation()` call and
 * can't differ per `.mutate()` invocation, so opting out would silence the
 * global net for the already-silent path too. Leaving it unset accepts a
 * redundant toast on the visible path in exchange for finally covering the
 * silent one.
 */
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
  const queryClient = useQueryClient();
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
    // The server writes a scanned item + daily log for the cooked meal.
    onSuccess: () => invalidateFoodLogQueries(queryClient),
    // Its one call site (CookSessionReviewScreen.handleLogMeal) already
    // toasts on failure via its own try/catch.
    meta: { silentError: true },
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
    // Its one call site (CookSessionReviewScreen.handleGenerateRecipe)
    // already toasts on failure via its own try/catch.
    meta: { silentError: true },
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
    // Its one call site (CookSessionReviewScreen.handleSubstitutions)
    // already toasts on failure via its own try/catch.
    meta: { silentError: true },
  });
}
