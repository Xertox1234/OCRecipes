import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { QueryErrorMeta } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";

export interface DailyBudget {
  calorieGoal: number;
  foodCalories: number;
  remaining: number;
}

export function useDailyBudget(
  date?: string,
  options?: { meta?: QueryErrorMeta },
) {
  const params = date ? `?date=${date}` : "";
  const tz = getDeviceTimezone();
  return useQuery<DailyBudget>({
    // Date is its own key element (not baked into the URL string in element
    // 0) so the undated and every dated variant share queryKey[0] ===
    // "/api/daily-budget" — one `invalidateQueries({ queryKey:
    // ["/api/daily-budget"] })` (TanStack's default partial/prefix match)
    // then reaches every variant instead of only the undated one. Include tz
    // in the key so cache entries are per-timezone (different users in
    // different tzs on the same device get distinct cache slots).
    queryKey: ["/api/daily-budget", date ?? null, { tz }],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/daily-budget${params}`,
        undefined,
        {
          headers: { "X-Timezone": tz },
        },
      );
      return res.json() as Promise<DailyBudget>;
    },
    meta: options?.meta,
  });
}
