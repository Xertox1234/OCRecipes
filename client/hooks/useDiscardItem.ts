import {
  useMutation,
  useQueryClient,
  onlineManager,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { enqueue } from "@/lib/offline-queue";
import { QUERY_KEYS } from "@/lib/query-keys";
import type { ScannedItemResponse, PaginatedResponse } from "@/types/api";

/**
 * Hook to soft-delete (discard) a scanned item.
 * Optimistically removes the item from the infinite query cache.
 */
export function useDiscardItem() {
  const queryClient = useQueryClient();

  return useMutation({
    // "always" so mutationFn RUNS while offline and the branch below can enqueue
    // the delete durably. With the default "online", an offline trigger pauses
    // the mutation in-memory (mutationFn never runs) and the queued write is lost
    // on force-quit — defeating the durable offline queue this hook integrates.
    networkMode: "always",
    mutationFn: async (itemId: number) => {
      if (!onlineManager.isOnline()) {
        await enqueue({
          endpoint: `/api/scanned-items/${itemId}`,
          method: "DELETE",
          body: undefined,
        });
        // Optimistic onMutate already removed the item. Signal "queued" so
        // onSettled skips invalidation and defers to the drain's post-replay
        // invalidation — otherwise a reconnect refetch can race the drain and
        // briefly un-delete the item (S1). Both paths must return the same
        // shape so onSettled can discriminate (DELETE has no response body).
        return { queued: true };
      }
      await apiRequest("DELETE", `/api/scanned-items/${itemId}`);
      return { queued: false };
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
            pages: old.pages.map((page) => {
              const filtered = page.items.filter((item) => item.id !== itemId);
              return {
                ...page,
                items: filtered,
                total:
                  filtered.length < page.items.length
                    ? page.total - 1
                    : page.total,
              };
            }),
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
    onSettled: (data) => {
      // Offline-queued deletes (data.queued === true) defer invalidation to the
      // drain's post-replay invalidation on reconnect. Online success
      // (data.queued === false) AND errors (data === undefined) still invalidate
      // here — the error path re-syncs the cache after onError's rollback.
      if (data?.queued) return;
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
    },
  });
}
