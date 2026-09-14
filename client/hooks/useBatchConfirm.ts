import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import type {
  ResolvedBatchItem,
  BatchDestination,
} from "@shared/types/batch-scan";

interface BatchConfirmParams {
  items: ResolvedBatchItem[];
  destination: BatchDestination;
  groceryListId?: number;
  mealType?: string;
}

interface BatchConfirmResponse {
  success: boolean;
  destination: BatchDestination;
  created: number;
  groceryListId?: number;
}

export function useBatchConfirm() {
  const queryClient = useQueryClient();

  return useMutation<BatchConfirmResponse, Error, BatchConfirmParams>({
    mutationFn: async ({ items, destination, groceryListId, mealType }) => {
      // X-Timezone is load-bearing for the "grocery_list" destination: the
      // server derives an auto-created list's calendar day from it (see
      // server/storage/batch.ts). Sent unconditionally, matching the other
      // apiRequest call sites — it's a no-op for the other two destinations.
      const res = await apiRequest(
        "POST",
        "/api/batch/save",
        {
          items,
          destination,
          groceryListId,
          mealType,
        },
        { headers: { "X-Timezone": getDeviceTimezone() } },
      );
      return res.json();
    },
    onSuccess: (_, { destination }) => {
      if (destination === "daily_log") {
        void queryClient.invalidateQueries({ queryKey: ["/api/daily-budget"] });
        void queryClient.invalidateQueries({
          queryKey: ["/api/scanned-items"],
        });
      } else if (destination === "pantry") {
        void queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
      } else if (destination === "grocery_list") {
        void queryClient.invalidateQueries({
          queryKey: ["/api/meal-plan/grocery-lists"],
        });
      }
    },
  });
}
