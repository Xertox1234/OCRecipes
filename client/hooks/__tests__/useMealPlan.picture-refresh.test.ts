import type { QueryClient } from "@tanstack/react-query";
import {
  PENDING_PICTURE_REFRESH_DELAYS_MS,
  refreshMealPlanItemsForPendingPicture,
} from "../useMealPlan";

describe("refreshMealPlanItemsForPendingPicture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function client() {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    return {
      queryClient: { invalidateQueries } as unknown as QueryClient,
      invalidateQueries,
    };
  }

  it("refreshes the plan items once at each delay, and not before the first", () => {
    const { queryClient, invalidateQueries } = client();
    refreshMealPlanItemsForPendingPicture(queryClient);

    vi.advanceTimersByTime(PENDING_PICTURE_REFRESH_DELAYS_MS[0] - 1);
    expect(invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(invalidateQueries).toHaveBeenCalledTimes(
      PENDING_PICTURE_REFRESH_DELAYS_MS.length,
    );
  });

  it("targets plan items only, not the recipe lists", () => {
    const { queryClient, invalidateQueries } = client();
    refreshMealPlanItemsForPendingPicture(queryClient);
    vi.advanceTimersByTime(PENDING_PICTURE_REFRESH_DELAYS_MS[0]);

    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(predicate({ queryKey: ["/api/meal-plan", "a", "b"] })).toBe(true);
    expect(predicate({ queryKey: ["/api/meal-plan/recipes"] })).toBe(false);
  });

  it("stops when cancelled", () => {
    const { queryClient, invalidateQueries } = client();
    const cancel = refreshMealPlanItemsForPendingPicture(queryClient);
    cancel();
    vi.advanceTimersByTime(60_000);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
