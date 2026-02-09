import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { GroceryList, GroceryListItem } from "@shared/schema";

type GroceryListWithItems = GroceryList & { items: GroceryListItem[] };

export function useGroceryLists() {
  return useQuery<GroceryList[]>({
    queryKey: ["/api/meal-plan/grocery-lists"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/meal-plan/grocery-lists");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
}

export function useGroceryListDetail(listId: number) {
  return useQuery<GroceryListWithItems>({
    queryKey: ["/api/meal-plan/grocery-lists", listId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/meal-plan/grocery-lists/${listId}`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: listId > 0,
  });
}

export function useCreateGroceryList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      startDate: string;
      endDate: string;
      title?: string;
    }): Promise<GroceryListWithItems> => {
      const res = await apiRequest(
        "POST",
        "/api/meal-plan/grocery-lists",
        params,
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/meal-plan/grocery-lists"],
      });
    },
  });
}

export function useToggleGroceryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      listId,
      itemId,
      isChecked,
    }: {
      listId: number;
      itemId: number;
      isChecked: boolean;
    }): Promise<GroceryListItem> => {
      const res = await apiRequest(
        "PUT",
        `/api/meal-plan/grocery-lists/${listId}/items/${itemId}`,
        { isChecked },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    onMutate: async ({ listId, itemId, isChecked }) => {
      await queryClient.cancelQueries({
        queryKey: ["/api/meal-plan/grocery-lists", listId],
      });

      const prev = queryClient.getQueryData<GroceryListWithItems>([
        "/api/meal-plan/grocery-lists",
        listId,
      ]);

      if (prev) {
        queryClient.setQueryData<GroceryListWithItems>(
          ["/api/meal-plan/grocery-lists", listId],
          {
            ...prev,
            items: prev.items.map((item) =>
              item.id === itemId ? { ...item, isChecked } : item,
            ),
          },
        );
      }

      return { prev };
    },
    onError: (_err, { listId }, context) => {
      if (context?.prev) {
        queryClient.setQueryData(
          ["/api/meal-plan/grocery-lists", listId],
          context.prev,
        );
      }
    },
    onSettled: (_data, _err, { listId }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/meal-plan/grocery-lists", listId],
      });
    },
  });
}

export function useAddManualGroceryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      listId,
      name,
      quantity,
      unit,
      category,
    }: {
      listId: number;
      name: string;
      quantity?: string | null;
      unit?: string | null;
      category?: string;
    }): Promise<GroceryListItem> => {
      const res = await apiRequest(
        "POST",
        `/api/meal-plan/grocery-lists/${listId}/items`,
        { name, quantity, unit, category },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    onSuccess: (_data, { listId }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/meal-plan/grocery-lists", listId],
      });
    },
  });
}

export function useDeleteGroceryList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest(
        "DELETE",
        `/api/meal-plan/grocery-lists/${id}`,
      );
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/meal-plan/grocery-lists"],
      });
    },
  });
}
