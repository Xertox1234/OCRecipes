import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import type { GroceryList, GroceryListItem } from "@shared/schema";

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

type GroceryListWithItems = GroceryList & { items: GroceryListItem[] };

export function useGroceryLists() {
  return useQuery<GroceryList[]>({
    queryKey: ["/api/meal-plan/grocery-lists"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/meal-plan/grocery-lists");
      if (!res.ok) throwStatusError(res.status);
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
      if (!res.ok) throwStatusError(res.status);
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
      void queryClient.invalidateQueries({
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
      void queryClient.invalidateQueries({
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
      void queryClient.invalidateQueries({
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
      void queryClient.invalidateQueries({
        queryKey: ["/api/meal-plan/grocery-lists"],
      });
    },
  });
}

export function useAddGroceryItemToPantry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      listId,
      itemId,
    }: {
      listId: number;
      itemId: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/meal-plan/grocery-lists/${listId}/items/${itemId}/add-to-pantry`,
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    onSuccess: (_data, { listId }) => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/meal-plan/grocery-lists", listId],
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/pantry/expiring"],
      });
    },
  });
}
