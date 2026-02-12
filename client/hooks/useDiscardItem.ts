import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { ScannedItemResponse, PaginatedResponse } from "@/types/api";

/**
 * Hook to soft-delete (discard) a scanned item.
 * Optimistically removes the item from the infinite query cache.
 */
export function useDiscardItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: number) => {
      await apiRequest("DELETE", `/api/scanned-items/${itemId}`);
    },
    onMutate: async (itemId: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/scanned-items"] });

      const previousData = queryClient.getQueryData(["/api/scanned-items"]);

      queryClient.setQueryData(
        ["/api/scanned-items"],
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
              items: page.items.filter((item) => item.id !== itemId),
              total: page.total - 1,
            })),
          };
        },
      );

      return { previousData };
    },
    onError: (_err, _itemId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["/api/scanned-items"], context.previousData);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scanned-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-summary"] });
    },
  });
}
