import type { QueryClient } from "@tanstack/react-query";

import { QUERY_KEYS } from "./query-keys";

/**
 * Refresh everything a new or removed daily-log entry changes: the scanned
 * items list, the daily summary, and the daily-budget calorie header. Call it
 * from every path that logs or discards food, so a new logging path can't
 * forget the calorie header again.
 */
export function invalidateFoodLogQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailyBudget });
}
