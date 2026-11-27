import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { getDeviceTimezone } from "@/lib/timezone";

export interface WeekCaloriesResponse {
  endDate: string;
  /** Seven days, oldest first. */
  calories: number[];
}

/**
 * The calories of `endDate` and the six days before it, in one request (the
 * Coach's week card, roadmap T3). Keyed under `QUERY_KEYS.dailySummary`, so
 * every log's `invalidateQueries({ queryKey: QUERY_KEYS.dailySummary })`
 * (prefix match) refreshes it with that one request too.
 */
export function useWeekCalories(endDate: string) {
  return useQuery<WeekCaloriesResponse>({
    queryKey: [...QUERY_KEYS.dailySummary, "week", endDate],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/daily-summary/week?end=${endDate}`,
        undefined,
        { headers: { "X-Timezone": getDeviceTimezone() } },
      );
      return res.json() as Promise<WeekCaloriesResponse>;
    },
  });
}
