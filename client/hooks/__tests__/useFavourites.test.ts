// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useToggleFavourite } from "../useFavourites";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const makePaginatedData = (
  items: { id: number; productName: string; isFavourited: boolean }[],
) => ({
  pages: [{ items, total: items.length }],
  pageParams: [undefined],
});

describe("useToggleFavourite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically toggles isFavourited in paginated cache", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    const items = [
      { id: 1, productName: "Apple", isFavourited: false },
      { id: 2, productName: "Banana", isFavourited: true },
    ];
    queryClient.setQueryData(["/api/scanned-items"], makePaginatedData(items));

    // Keep API pending to inspect optimistic state
    mockApiRequest.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useToggleFavourite(), { wrapper });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => {
      const data = queryClient.getQueryData<
        ReturnType<typeof makePaginatedData>
      >(["/api/scanned-items"]);
      const apple = data?.pages[0].items.find((i) => i.id === 1);
      expect(apple?.isFavourited).toBe(true);
      // Other item unchanged
      const banana = data?.pages[0].items.find((i) => i.id === 2);
      expect(banana?.isFavourited).toBe(true);
    });
  });

  it("rolls back on API error", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    const items = [{ id: 1, productName: "Apple", isFavourited: false }];
    queryClient.setQueryData(["/api/scanned-items"], makePaginatedData(items));

    mockApiRequest.mockRejectedValue(new Error("Server error"));

    const { result } = renderHook(() => useToggleFavourite(), { wrapper });

    await act(async () => {
      result.current.mutate(1);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Should be rolled back
    const data = queryClient.getQueryData<ReturnType<typeof makePaginatedData>>(
      ["/api/scanned-items"],
    );
    expect(data?.pages[0].items[0].isFavourited).toBe(false);
  });

  it("calls correct API endpoint", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      json: () => Promise.resolve({ isFavourited: true }),
    });

    const { result } = renderHook(() => useToggleFavourite(), { wrapper });

    await act(async () => {
      result.current.mutate(42);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/scanned-items/42/favourite",
    );
  });

  it("invalidates scanned-items on settled", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    queryClient.setQueryData(
      ["/api/scanned-items"],
      makePaginatedData([{ id: 1, productName: "Apple", isFavourited: false }]),
    );

    mockApiRequest.mockResolvedValue({
      json: () => Promise.resolve({ isFavourited: true }),
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useToggleFavourite(), { wrapper });

    await act(async () => {
      result.current.mutate(1);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/scanned-items"],
    });
  });

  it("handles missing cache gracefully", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      json: () => Promise.resolve({ isFavourited: true }),
    });

    const { result } = renderHook(() => useToggleFavourite(), { wrapper });

    await act(async () => {
      result.current.mutate(999);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });
});
