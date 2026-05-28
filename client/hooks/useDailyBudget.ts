import { useQuery } from "@tanstack/react-query";
import type { QueryErrorMeta } from "@/lib/query-client";

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
  return useQuery<DailyBudget>({
    queryKey: [`/api/daily-budget${params}`],
    meta: options?.meta,
  });
}
