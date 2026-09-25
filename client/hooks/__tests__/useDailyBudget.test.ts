// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDailyBudget } from "../useDailyBudget";
import { useBatchConfirm } from "../useBatchConfirm";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

// Fixed so the undated and dated useDailyBudget queries below share the same
// `{ tz }` key segment regardless of the host's real timezone.
vi.mock("@/lib/timezone", () => ({
  getDeviceTimezone: () => "UTC",
}));

describe("useDailyBudget", () => {
  it("uses correct query key without date", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const mockData = {
      calorieGoal: 2000,
      foodCalories: 800,
      remaining: 1200,
    };
    // Query key now includes a { tz } segment for timezone-aware caching,
    // plus an explicit `null` date element (P1-2026-09-23) so the undated and
    // dated variants share element 0 and one invalidation covers both.
    // getDeviceTimezone() is mocked to "UTC" above — seed with that same value.
    const tz = "UTC";
    queryClient.setQueryData(["/api/daily-budget", null, { tz }], mockData);

    const { result } = renderHook(() => useDailyBudget(), { wrapper });

    expect(result.current.data).toEqual(mockData);
  });

  it("includes date in query key when provided", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const mockData = {
      calorieGoal: 2000,
      foodCalories: 500,
      remaining: 1500,
    };
    const tz = "UTC";
    queryClient.setQueryData(
      ["/api/daily-budget", "2024-06-15", { tz }],
      mockData,
    );

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

// P1-2026-09-23: the dated variant's queryKey used to bake the date into
// element 0 as part of the URL string (`/api/daily-budget?date=...`), which
// made it a completely different first element from the undated variant's
// `/api/daily-budget`. TanStack's default (non-`exact`) invalidateQueries
// match requires queryKey[0] to be EQUAL, not merely prefixed, so a food-log
// mutation invalidating `["/api/daily-budget"]` (as useBatchConfirm already
// does) only ever reached the undated query — Home refreshed, Plan's dated
// calorie ring stayed stale. Restructuring the key to
// `["/api/daily-budget", date ?? null, { tz }]` puts the date in its own
// element so both variants share element 0 and one invalidation covers both.
describe("useDailyBudget — prefix invalidation after a food-log mutation", () => {
  const validItem = {
    id: "batch-1",
    barcode: "0012345678905",
    productName: "Test Product",
    quantity: 1,
    status: "resolved" as const,
    calories: 200,
    protein: 10,
    carbs: 25,
    fat: 8,
  };

  it("refetches BOTH an undated and a dated useDailyBudget query after a daily_log batch confirm succeeds", async () => {
    const { wrapper } = createQueryWrapper();

    let budgetGetCount = 0;
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.startsWith("/api/daily-budget")) {
        budgetGetCount++;
        return {
          json: async () => ({
            calorieGoal: 2000,
            foodCalories: 100 * budgetGetCount,
            remaining: 2000 - 100 * budgetGetCount,
          }),
        };
      }
      if (method === "POST" && url === "/api/batch/save") {
        return {
          json: async () => ({
            success: true,
            destination: "daily_log",
            created: 1,
          }),
        };
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });

    const undated = renderHook(() => useDailyBudget(), { wrapper });
    const dated = renderHook(() => useDailyBudget("2024-06-15"), { wrapper });
    const batchConfirm = renderHook(() => useBatchConfirm(), { wrapper });

    await waitFor(() => expect(undated.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(dated.result.current.isSuccess).toBe(true));
    expect(budgetGetCount).toBe(2); // one initial GET per query

    await act(async () => {
      batchConfirm.result.current.mutate({
        items: [validItem],
        destination: "daily_log",
      });
    });
    await waitFor(() =>
      expect(batchConfirm.result.current.isSuccess).toBe(true),
    );

    // Both the undated AND dated queries must refetch — proving the
    // mutation's single `["/api/daily-budget"]` invalidation reaches every
    // date variant, not just the undated one.
    await waitFor(() => expect(budgetGetCount).toBe(4));
  });
});
