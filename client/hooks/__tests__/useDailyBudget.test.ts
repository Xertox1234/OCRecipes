// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { useDailyBudget } from "../useDailyBudget";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

vi.mock("@/lib/query-client", () => ({
  apiRequest: vi.fn(),
}));

describe("useDailyBudget", () => {
  it("uses correct query key without date", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const mockData = {
      calorieGoal: 2000,
      foodCalories: 800,
      exerciseCalories: 200,
      adjustedBudget: 2200,
      remaining: 1400,
      exerciseMinutes: 30,
      exerciseCount: 1,
    };
    queryClient.setQueryData(["/api/daily-budget"], mockData);

    const { result } = renderHook(() => useDailyBudget(), { wrapper });

    expect(result.current.data).toEqual(mockData);
  });

  it("includes date in query key when provided", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const mockData = {
      calorieGoal: 2000,
      foodCalories: 500,
      exerciseCalories: 0,
      adjustedBudget: 2000,
      remaining: 1500,
      exerciseMinutes: 0,
      exerciseCount: 0,
    };
    queryClient.setQueryData(["/api/daily-budget?date=2024-06-15"], mockData);

    const { result } = renderHook(() => useDailyBudget("2024-06-15"), {
      wrapper,
    });

    expect(result.current.data).toEqual(mockData);
  });

  it("returns undefined data initially when not cached", () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useDailyBudget(), { wrapper });
    expect(result.current.data).toBeUndefined();
  });
});
