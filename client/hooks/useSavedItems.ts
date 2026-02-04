import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import type { SavedItem } from "@shared/schema";
import type { CreateSavedItemInput } from "@shared/schemas/saved-items";

/**
 * Hook to fetch all saved items for the current user.
 */
export function useSavedItems() {
  return useQuery<SavedItem[]>({
    queryKey: ["/api/saved-items"],
  });
}

/**
 * Hook to fetch the count of saved items for the current user.
 */
export function useSavedItemCount() {
  return useQuery<{ count: number }>({
    queryKey: ["/api/saved-items/count"],
  });
}

/**
 * Hook to create a new saved item.
 * Returns null from mutationFn if limit reached (403).
 */
export function useCreateSavedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: CreateSavedItemInput) => {
      const baseUrl = getApiUrl();
      const token = await tokenStorage.get();

      const response = await fetch(`${baseUrl}/api/saved-items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(item),
      });

      // Check for limit reached (403)
      if (response.status === 403) {
        const data = await response.json();
        if (data.error === "LIMIT_REACHED") {
          return { limitReached: true as const };
        }
        throw new Error(data.message || "Forbidden");
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }

      const savedItem = (await response.json()) as SavedItem;
      return { limitReached: false as const, item: savedItem };
    },
    onSuccess: (data) => {
      if (!data.limitReached) {
        queryClient.invalidateQueries({ queryKey: ["/api/saved-items"] });
        queryClient.invalidateQueries({ queryKey: ["/api/saved-items/count"] });
      }
    },
  });
}

/**
 * Hook to delete a saved item.
 */
export function useDeleteSavedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/saved-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/saved-items/count"] });
    },
  });
}
