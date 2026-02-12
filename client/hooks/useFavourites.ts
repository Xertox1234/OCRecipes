import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
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
        queryClient.setQueryData(["/api/scanned-items"], context.previousData);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scanned-items"] });
    },
  });
}
