// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { useCalorieGoal, GOALS_QUERY_KEY } from "../useCalorieGoal";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

describe("useCalorieGoal", () => {
  it("reads the goal from /api/goals, the key GoalSetup invalidates on save", () => {
    expect(GOALS_QUERY_KEY).toEqual(["/api/goals"]);
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(GOALS_QUERY_KEY, {
      dailyCalorieGoal: 1850,
      dailyProteinGoal: 140,
      dailyCarbsGoal: 200,
      dailyFatGoal: 60,
      goalsCalculatedAt: null,
    });
    const { result } = renderHook(() => useCalorieGoal(), { wrapper });
    expect(result.current.data).toEqual({ calorieGoal: 1850 });
  });

  it("falls back to the default goal when the user has none set, as /api/daily-budget does", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(GOALS_QUERY_KEY, {
      dailyCalorieGoal: null,
      dailyProteinGoal: null,
      dailyCarbsGoal: null,
      dailyFatGoal: null,
      goalsCalculatedAt: null,
    });
    const { result } = renderHook(() => useCalorieGoal(), { wrapper });
    expect(result.current.data).toEqual({ calorieGoal: 2000 });
  });

  it("has no data before the goals load, so a failed load is not shown as the default", () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCalorieGoal(), { wrapper });
    expect(result.current.data).toBeUndefined();
  });
});
