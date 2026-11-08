// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { useDailySummary } from "../useDailySummary";
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

const summary = { totalCalories: 900, itemCount: 3 };

describe("useDailySummary", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => summary });
  });

  it("fetches today's summary with the device timezone under the bare key", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    const { result } = renderHook(() => useDailySummary(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/daily-summary",
      undefined,
      { headers: { "X-Timezone": "Pacific/Auckland" } },
    );
    expect(queryClient.getQueryData(QUERY_KEYS.dailySummary)).toEqual(summary);
  });

  it("fetches a dated summary under a key that the bare-prefix invalidation reaches", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    const { result } = renderHook(() => useDailySummary("2026-11-08"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/daily-summary?date=2026-11-08",
      undefined,
      { headers: { "X-Timezone": "Pacific/Auckland" } },
    );
    const key = [...QUERY_KEYS.dailySummary, "2026-11-08"];
    expect(queryClient.getQueryData(key)).toEqual(summary);

    // The bare-prefix invalidation every log path uses must refetch this
    // dated entry too (an active query refetches on invalidate).
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
    expect(mockApiRequest).toHaveBeenCalledTimes(2);
  });

  it("puts the caller's error meta on the query", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    const { result } = renderHook(
      () => useDailySummary(undefined, { meta: { silentError: true } }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: QUERY_KEYS.dailySummary, exact: true });
    expect(query?.meta).toEqual({ silentError: true });
  });
});
