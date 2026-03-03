// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useDiscardItem } from "../useDiscardItem";
import { QUERY_KEYS } from "@/lib/query-keys";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const makePaginatedData = (items: { id: number; productName: string }[]) => ({
  pages: [{ items, total: items.length }],
  pageParams: [undefined],
});

describe("useDiscardItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically removes item from cache on mutate", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    const items = [
      { id: 1, productName: "Apple" },
      { id: 2, productName: "Banana" },
      { id: 3, productName: "Cherry" },
    ];
    queryClient.setQueryData(QUERY_KEYS.scannedItems, makePaginatedData(items));

    // Make the API call hang so we can inspect optimistic state
    mockApiRequest.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDiscardItem(), { wrapper });

    act(() => {
      result.current.mutate(2);
    });

    await waitFor(() => {
      const data = queryClient.getQueryData<
        ReturnType<typeof makePaginatedData>
      >(QUERY_KEYS.scannedItems);
      expect(data?.pages[0].items).toHaveLength(2);
      expect(data?.pages[0].items.map((i) => i.id)).toEqual([1, 3]);
      expect(data?.pages[0].total).toBe(2);
    });
  });

  it("rolls back cache on API error", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    const items = [
      { id: 1, productName: "Apple" },
      { id: 2, productName: "Banana" },
    ];
    queryClient.setQueryData(QUERY_KEYS.scannedItems, makePaginatedData(items));

    mockApiRequest.mockRejectedValue(new Error("Server error"));

    const { result } = renderHook(() => useDiscardItem(), { wrapper });

    await act(async () => {
      result.current.mutate(2);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Cache should be rolled back to original
    const data = queryClient.getQueryData<ReturnType<typeof makePaginatedData>>(
      QUERY_KEYS.scannedItems,
    );
    expect(data?.pages[0].items).toHaveLength(2);
    expect(data?.pages[0].items.map((i) => i.id)).toEqual([1, 2]);
  });

  it("invalidates related queries on settled", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    queryClient.setQueryData(
      QUERY_KEYS.scannedItems,
      makePaginatedData([{ id: 1, productName: "Apple" }]),
    );

    mockApiRequest.mockResolvedValue({});
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDiscardItem(), { wrapper });

    await act(async () => {
      result.current.mutate(1);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: QUERY_KEYS.scannedItems,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: QUERY_KEYS.dailySummary,
    });
  });

  it("handles mutate when cache is empty", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({});

    const { result } = renderHook(() => useDiscardItem(), { wrapper });

    await act(async () => {
      result.current.mutate(999);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "DELETE",
      "/api/scanned-items/999",
    );
  });
});
