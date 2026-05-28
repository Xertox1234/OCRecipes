import { useQuery } from "@tanstack/react-query";

export interface DailyBudget {
  calorieGoal: number;
  foodCalories: number;
  remaining: number;
}

export function useDailyBudget(
  date?: string,
  options?: { silentError?: boolean },
) {
  const params = date ? `?date=${date}` : "";
  return useQuery<DailyBudget>({
    queryKey: [`/api/daily-budget${params}`],
    // Opt-in suppression of the global error toast for callers that render
    // their own inline error UI (the Home tab). Other callers stay covered by
    // the global net.
    meta: options?.silentError ? { silentError: true } : undefined,
  });
}
