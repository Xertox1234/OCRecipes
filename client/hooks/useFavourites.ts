import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  TOGGLE_FAVOURITE_ITEM_KEY,
  toggleFavouriteItemFn,
  settleFavouriteItemToggle,
} from "@/lib/mutation-defaults";
import type { ScannedItemResponse, PaginatedResponse } from "@/types/api";

/**
 * Hook to toggle favourite status on a scanned item.
 * Uses optimistic update on the infinite scanned-items query.
 */
export function useToggleFavourite() {
  const queryClient = useQueryClient();

  return useMutation({
    // Durable across a restart: the key + mutationFn are registered in
    // client/lib/mutation-defaults.ts.
    mutationKey: TOGGLE_FAVOURITE_ITEM_KEY,
    mutationFn: toggleFavouriteItemFn,
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
    onSettled: () => settleFavouriteItemToggle(queryClient),
    // Reviewed for the global mutation net (2026-09-25): no opt-out — its
    // one call site (useHistoryData.handleFavourite, via HistoryScreen)
    // shows no visible failure feedback beyond this rollback, so the global
    // toast is a genuine improvement here.
  });
}
