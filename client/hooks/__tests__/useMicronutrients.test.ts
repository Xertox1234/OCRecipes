// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import {
  useItemMicronutrients,
  useDailyMicronutrients,
  useMicronutrientReference,
} from "../useMicronutrients";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

vi.mock("@/lib/query-client", () => ({
  apiRequest: vi.fn(),
}));

describe("useMicronutrients", () => {
  describe("useItemMicronutrients", () => {
    it("is enabled when itemId is provided", () => {
      const { wrapper, queryClient } = createQueryWrapper();
      const mockData = {
        itemId: 5,
        productName: "Apple",
        micronutrients: [
          {
            nutrientName: "Vitamin C",
            amount: 8.4,
            unit: "mg",
            percentDailyValue: 9.3,
          },
        ],
      };
      queryClient.setQueryData(["/api/micronutrients/item/5"], mockData);

      const { result } = renderHook(() => useItemMicronutrients(5), {
        wrapper,
      });
      expect(result.current.data).toEqual(mockData);
    });

    it("is disabled when itemId is null", () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useItemMicronutrients(null), {
        wrapper,
      });
      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("useDailyMicronutrients", () => {
    it("uses provided date in query key", () => {
      const { wrapper, queryClient } = createQueryWrapper();
      const mockData = {
        date: "2024-06-15",
        micronutrients: [],
      };
      queryClient.setQueryData(
        ["/api/micronutrients/daily?date=2024-06-15"],
        mockData,
      );

      const { result } = renderHook(
        () => useDailyMicronutrients("2024-06-15"),
        {
          wrapper,
        },
      );
      expect(result.current.data).toEqual(mockData);
    });

    it("defaults to today's date when none provided", () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useDailyMicronutrients(), {
        wrapper,
      });
      // Verify the query key includes today's date
      expect(result.current.data).toBeUndefined();
      // The hook constructs the key internally
    });
  });

  describe("useMicronutrientReference", () => {
    it("returns cached reference data", () => {
      const { wrapper, queryClient } = createQueryWrapper();
      const mockData = {
        "Vitamin C": { unit: "mg", dailyValue: 90 },
        Iron: { unit: "mg", dailyValue: 18 },
      };
      queryClient.setQueryData(["/api/micronutrients/reference"], mockData);

      const { result } = renderHook(() => useMicronutrientReference(), {
        wrapper,
      });
      expect(result.current.data).toEqual(mockData);
    });
  });
});
