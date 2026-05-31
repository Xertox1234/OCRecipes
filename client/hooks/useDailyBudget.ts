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
    // Include tz in the key so cache entries are per-timezone (different users
    // in different tzs on the same device get distinct cache slots).
    queryKey: [`/api/daily-budget${params}`, { tz }],
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
