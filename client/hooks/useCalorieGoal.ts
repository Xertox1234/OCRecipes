import { useQuery } from "@tanstack/react-query";
import type { QueryErrorMeta } from "@/lib/query-client";
import type { GoalsResponse } from "@/types/api";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

/**
 * The key GoalSetupScreen invalidates after a save. Not a QUERY_KEYS entry:
 * App.tsx persists every QUERY_KEYS key.
 */
export const GOALS_QUERY_KEY = ["/api/goals"] as const;

function toCalorieGoal(goals: GoalsResponse): { calorieGoal: number } {
  // Same fallback as /api/daily-budget.
  return {
    calorieGoal: goals.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories,
  };
}

/**
 * The user's daily calorie goal on its own. For a screen that needs the goal
 * but not the day's intake: /api/daily-budget also totals the day's log, which
 * /api/daily-summary has already done for a screen that loads both (perf audit
 * 2026-11-08, L5). The goal does not depend on the day, so one fetch serves
 * every date.
 */
export function useCalorieGoal(options?: { meta?: QueryErrorMeta }) {
  return useQuery<GoalsResponse, Error, { calorieGoal: number }>({
    queryKey: GOALS_QUERY_KEY,
    select: toCalorieGoal,
    meta: options?.meta,
  });
}
