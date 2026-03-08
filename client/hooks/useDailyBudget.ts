import { useQuery } from "@tanstack/react-query";

export interface DailyBudget {
  calorieGoal: number;
  foodCalories: number;
  remaining: number;
}

export function useDailyBudget(date?: string) {
  const params = date ? `?date=${date}` : "";
  return useQuery<DailyBudget>({
    queryKey: [`/api/daily-budget${params}`],
  });
}
