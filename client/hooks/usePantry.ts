import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { PantryItem } from "@shared/schema";

export function usePantryItems() {
  return useQuery<PantryItem[]>({
    queryKey: ["/api/pantry"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pantry");
      return res.json();
    },
  });
}

export function useExpiringPantryItems(enabled = true) {
  return useQuery<PantryItem[]>({
    queryKey: ["/api/pantry/expiring"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pantry/expiring");
      return res.json();
    },
    enabled,
  });
}

export function useCreatePantryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: {
      name: string;
      quantity?: string | number | null;
      unit?: string | null;
      category?: string;
      expiresAt?: string | null;
    }): Promise<PantryItem> => {
      const res = await apiRequest("POST", "/api/pantry", item);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/pantry/expiring"],
      });
    },
  });
}

export function useUpdatePantryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: number;
      name?: string;
      quantity?: string | number | null;
      unit?: string | null;
      category?: string;
      expiresAt?: string | null;
    }): Promise<PantryItem> => {
      const res = await apiRequest("PUT", `/api/pantry/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/pantry/expiring"],
      });
    },
  });
}

export function useDeletePantryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/pantry/${id}`);
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/pantry/expiring"],
      });
    },
  });
}
