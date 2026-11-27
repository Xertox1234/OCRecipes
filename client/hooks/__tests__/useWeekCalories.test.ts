// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { useWeekCalories } from "../useWeekCalories";
import { QUERY_KEYS } from "@/lib/query-keys";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@/lib/timezone", () => ({
  getDeviceTimezone: () => "Pacific/Auckland",
}));

const week = { endDate: "2026-11-20", calories: [1, 2, 3, 4, 5, 6, 7] };

describe("useWeekCalories", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => week });
  });

  it("reads the week in one request, with the device timezone", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useWeekCalories("2026-11-20"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/daily-summary/week?end=2026-11-20",
      undefined,
      { headers: { "X-Timezone": "Pacific/Auckland" } },
    );
    expect(
      queryClient.getQueryData([
        ...QUERY_KEYS.dailySummary,
        "week",
        "2026-11-20",
      ]),
    ).toEqual(week);
  });

  it("is refreshed, in one request, by the invalidation every log makes", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useWeekCalories("2026-11-20"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
    expect(mockApiRequest).toHaveBeenCalledTimes(2);
  });
});
