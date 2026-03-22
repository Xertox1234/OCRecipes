import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
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
      if (!res.ok) throw new Error(`${res.status}`);
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
      if (!res.ok) throw new Error(`${res.status}`);
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
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
    },
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
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks", id] });
    },
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
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
    },
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
      if (!res.ok) {
        if (res.status === 409) {
          throw new Error("Recipe already in cookbook");
        }
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    onSuccess: (_data, { cookbookId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/cookbooks", cookbookId],
      });
    },
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
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/cookbooks", cookbookId],
      });
    },
  });
}
