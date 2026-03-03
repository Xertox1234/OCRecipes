import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import type { ScannedItemResponse, PaginatedResponse } from "@/types/api";

/**
 * Hook to toggle favourite status on a scanned item.
 * Uses optimistic update on the infinite scanned-items query.
 */
export function useToggleFavourite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/scanned-items/${itemId}/favourite`,
      );
      return res.json() as Promise<{ isFavourited: boolean }>;
    },
    onMutate: async (itemId: number) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.scannedItems });

      const previousData = queryClient.getQueryData(QUERY_KEYS.scannedItems);

      queryClient.setQueryData(
        QUERY_KEYS.scannedItems,
        (
          old:
            | {
                pages: PaginatedResponse<ScannedItemResponse>[];
                pageParams: unknown[];
              }
            | undefined,
        ) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.id === itemId
                  ? { ...item, isFavourited: !item.isFavourited }
                  : item,
              ),
            })),
          };
        },
      );

      return { previousData };
    },
    onError: (_err, _itemId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(QUERY_KEYS.scannedItems, context.previousData);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
    },
  });
}
