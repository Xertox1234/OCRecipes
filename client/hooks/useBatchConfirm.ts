import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
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
      const res = await apiRequest("POST", "/api/batch/save", {
        items,
        destination,
        groceryListId,
        mealType,
      });
      return res.json();
    },
    onSuccess: (_, { destination }) => {
      if (destination === "daily_log") {
        queryClient.invalidateQueries({ queryKey: ["/api/daily-budget"] });
        queryClient.invalidateQueries({ queryKey: ["/api/scanned-items"] });
      } else if (destination === "pantry") {
        queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
      } else if (destination === "grocery_list") {
        queryClient.invalidateQueries({
          queryKey: ["/api/meal-plan/grocery-lists"],
        });
      }
    },
  });
}
