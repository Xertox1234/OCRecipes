// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  invalidateMealPlanItems,
  useAddMealPlanItem,
  useRemoveMealPlanItem,
  useConfirmMealPlanItem,
} from "../useMealPlan";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useMealPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("invalidateMealPlanItems", () => {
    it("invalidates queries starting with /api/meal-plan but not /api/meal-plan/recipes", async () => {
      const { queryClient } = createQueryWrapper();

      // Seed both meal-plan item and recipe queries
      queryClient.setQueryData(
        ["/api/meal-plan", "2024-01-01", "2024-01-07"],
        [],
      );
      queryClient.setQueryData(["/api/meal-plan/recipes", 1], { id: 1 });
      queryClient.setQueryData(["/api/recipes/browse"], []);

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      invalidateMealPlanItems(queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith({
        predicate: expect.any(Function),
      });

      // Verify the predicate function matches correctly
      const call = invalidateSpy.mock.calls[0][0] as unknown as {
        predicate: (query: { queryKey: unknown[] }) => boolean;
      };
      const predicate = call.predicate;

      expect(
        predicate({ queryKey: ["/api/meal-plan", "2024-01-01", "2024-01-07"] }),
      ).toBe(true);
      expect(predicate({ queryKey: ["/api/meal-plan"] })).toBe(true);
      expect(predicate({ queryKey: ["/api/meal-plan/recipes", 1] })).toBe(
        false,
      );
      expect(predicate({ queryKey: ["/api/meal-plan/items"] })).toBe(false);
      expect(predicate({ queryKey: ["/api/recipes/browse"] })).toBe(false);
      expect(predicate({ queryKey: [] })).toBe(false);
    });
  });

  describe("useAddMealPlanItem", () => {
    it("calls correct API endpoint with item data", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, plannedDate: "2024-01-01" }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useAddMealPlanItem(), { wrapper });

      const item = {
        recipeId: 5,
        plannedDate: "2024-01-01",
        mealType: "lunch",
        servings: 2,
      };

      await act(async () => {
        result.current.mutate(item);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/meal-plan/items",
        item,
      );
      expect(invalidateSpy).toHaveBeenCalled();
    });

    it("throws on non-ok response", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      });

      const { result } = renderHook(() => useAddMealPlanItem(), { wrapper });

      await act(async () => {
        result.current.mutate({
          plannedDate: "2024-01-01",
          mealType: "lunch",
        });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("400: Bad Request");
    });
  });

  describe("useRemoveMealPlanItem", () => {
    it("calls DELETE endpoint and invalidates meal plan queries", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({ ok: true, status: 204 });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useRemoveMealPlanItem(), { wrapper });

      await act(async () => {
        result.current.mutate(42);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/meal-plan/items/42",
      );
      expect(invalidateSpy).toHaveBeenCalled();
    });
  });

  describe("useConfirmMealPlanItem", () => {
    it("calls confirm endpoint and invalidates daily-summary", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ confirmed: true }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useConfirmMealPlanItem(), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate(7);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/meal-plan/items/7/confirm",
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/daily-summary"],
      });
    });
  });
});
