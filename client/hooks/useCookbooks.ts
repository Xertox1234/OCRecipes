import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { uploadCookbookCover } from "@/lib/cookbook-cover-upload";
import type { CookbookCoverStyle } from "@shared/constants/cookbook-cover-styles";
import type {
  Cookbook,
  CookbookWithCount,
  ResolvedCookbookRecipe,
} from "@shared/schema";

type CookbookDetail = Cookbook & { recipes: ResolvedCookbookRecipe[] };

export function useCookbooks() {
  return useQuery<CookbookWithCount[]>({
    queryKey: ["/api/cookbooks"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/cookbooks");
      return res.json();
    },
    // Recipe counts change from other screens — always refetch when
    // a component re-subscribes (e.g. navigating back in the stack)
    refetchOnMount: "always",
  });
}

export function useCookbookDetail(id: number) {
  return useQuery<CookbookDetail>({
    queryKey: ["/api/cookbooks", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/cookbooks/${id}`);
      return res.json();
    },
    enabled: id > 0,
    refetchOnMount: "always",
  });
}

export function useCreateCookbook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      description?: string;
    }): Promise<Cookbook> => {
      const res = await apiRequest("POST", "/api/cookbooks", params);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
    },
    // Both call sites (CookbookPickerModal, CookbookCreateScreen) already
    // show a visible error (Alert/InlineError) on failure.
    meta: { silentError: true },
  });
}

export function useUpdateCookbook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: number;
      name?: string;
      description?: string | null;
    }): Promise<Cookbook> => {
      const res = await apiRequest("PATCH", `/api/cookbooks/${id}`, data);
      return res.json();
    },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/cookbooks", id] });
    },
    // Its one call site (CookbookCreateScreen) already shows an InlineError
    // on failure.
    meta: { silentError: true },
  });
}

/**
 * Attach an uploaded cover image to an existing cookbook. Not premium-gated.
 *
 * Goes through `uploadCookbookCover` rather than `apiRequest` because the
 * payload is multipart — `apiRequest` only speaks JSON.
 */
export function useUploadCookbookCover() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      cookbookId,
      uri,
    }: {
      cookbookId: number;
      uri: string;
    }): Promise<Cookbook> => uploadCookbookCover(cookbookId, uri),
    onSuccess: (_data, { cookbookId }) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/cookbooks", cookbookId],
      });
    },
    // Its one call site (CookbookCreateScreen) already shows a visible
    // toast.error on failure (inline or batched with the create flow).
    meta: { silentError: true },
  });
}

/**
 * Generate a cover image with AI. Premium-only — the server returns 403
 * `PREMIUM_REQUIRED` for free-tier users, and 503 when no image provider
 * could produce one.
 */
export function useGenerateCookbookCover() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (cookbookId: number): Promise<Cookbook> => {
      const res = await apiRequest(
        "POST",
        `/api/cookbooks/${cookbookId}/cover/generate`,
      );
      return res.json();
    },
    onSuccess: (_data, cookbookId) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/cookbooks", cookbookId],
      });
    },
    // Its one call site (CookbookCreateScreen) already shows a visible
    // toast.error / upgrade-modal on failure.
    meta: { silentError: true },
  });
}

/** One set from the cover studio (`POST /api/cookbook-covers/candidates`). */
export interface CoverCandidateSet {
  candidates: { id: string; imageUrl: string }[];
  expiresAt: string;
  /** The user asked for something and every candidate fell back to food. */
  promptIgnored: boolean;
}

/**
 * The server's own bound is ~60 s (a 15 s pre-pass, then four images in
 * parallel at 45 s each); this leaves headroom past the default deadline.
 */
const COVER_SET_DEADLINE_MS = 75_000;

export interface CoverSetRequest {
  name: string;
  description?: string;
  coverPrompt?: string;
  style: CookbookCoverStyle;
}

/**
 * Module-level, not inline in the mutation: a try/finally inside a hook
 * callback makes React Compiler skip the file.
 */
async function postCoverSet(
  input: CoverSetRequest,
): Promise<CoverCandidateSet> {
  // Own signal, so apiRequest's shorter default deadline doesn't apply.
  // AbortController + setTimeout: Hermes has no AbortSignal.timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COVER_SET_DEADLINE_MS);
  try {
    const res = await apiRequest(
      "POST",
      "/api/cookbook-covers/candidates",
      input,
      { signal: controller.signal },
    );
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate a set of four candidate covers before the cookbook exists.
 * Premium-only (403 `PREMIUM_REQUIRED`); 429 `DAILY_LIMIT_REACHED` at the
 * daily cap; 503 when no set could be made.
 */
export function useGenerateCoverCandidates() {
  return useMutation({
    mutationFn: postCoverSet,
    // The studio shows its own inline error.
    meta: { silentError: true },
  });
}

/** Attach a picked studio cover to a cookbook, by candidate id. */
export function useAttachCoverCandidate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      cookbookId,
      candidateId,
    }: {
      cookbookId: number;
      candidateId: string;
    }): Promise<Cookbook> => {
      const res = await apiRequest(
        "POST",
        `/api/cookbooks/${cookbookId}/cover/candidate`,
        { candidateId },
      );
      return res.json();
    },
    onSuccess: (_data, { cookbookId }) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/cookbooks", cookbookId],
      });
    },
    // Its call site reports a failed cover through the create flow's outcome.
    meta: { silentError: true },
  });
}

export function useDeleteCookbook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/cookbooks/${id}`);
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
    },
    // Both call sites (CookbookDetailScreen, CookbookListScreen) already
    // toast on failure.
    meta: { silentError: true },
  });
}

export function useAddRecipeToCookbook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      cookbookId,
      recipeId,
      recipeType,
    }: {
      cookbookId: number;
      recipeId: number;
      recipeType: "mealPlan" | "community";
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/cookbooks/${cookbookId}/recipes`,
        { recipeId, recipeType },
      );
      // apiRequest throws ApiError on any non-ok response (incl. 409 with
      // code CONFLICT for a duplicate add), so res is always ok here.
      return res.json();
    },
    onSuccess: (_data, { cookbookId }) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/cookbooks", cookbookId],
      });
    },
    // Its one call site (CookbookPickerModal) already shows an Alert on
    // failure.
    meta: { silentError: true },
  });
}

export function useRemoveRecipeFromCookbook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      cookbookId,
      recipeId,
      recipeType,
    }: {
      cookbookId: number;
      recipeId: number;
      recipeType: "mealPlan" | "community";
    }) => {
      const res = await apiRequest(
        "DELETE",
        `/api/cookbooks/${cookbookId}/recipes/${recipeId}?recipeType=${recipeType}`,
      );
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
    },
    onSuccess: (_data, { cookbookId }) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/cookbooks", cookbookId],
      });
    },
    // Its one call site (CookbookDetailScreen) already toasts on failure.
    meta: { silentError: true },
  });
}
