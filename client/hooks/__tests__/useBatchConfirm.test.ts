// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useBatchConfirm } from "../useBatchConfirm";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

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

describe("useBatchConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls POST /api/batch/save with correct body", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          destination: "daily_log",
          created: 1,
        }),
    });

    const { result } = renderHook(() => useBatchConfirm(), { wrapper });

    await act(async () => {
      result.current.mutate({
        items: [validItem],
        destination: "daily_log",
        mealType: "lunch",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/batch/save", {
      items: [validItem],
      destination: "daily_log",
      groceryListId: undefined,
      mealType: "lunch",
    });
  });

  it("invalidates daily-budget and scanned-items on daily_log success", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    mockApiRequest.mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          destination: "daily_log",
          created: 2,
        }),
    });

    const { result } = renderHook(() => useBatchConfirm(), { wrapper });

    await act(async () => {
      result.current.mutate({
        items: [validItem],
        destination: "daily_log",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/daily-budget"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/scanned-items"],
    });
  });

  it("invalidates pantry queries on pantry success", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    mockApiRequest.mockResolvedValue({
      json: () =>
        Promise.resolve({ success: true, destination: "pantry", created: 1 }),
    });

    const { result } = renderHook(() => useBatchConfirm(), { wrapper });

    await act(async () => {
      result.current.mutate({
        items: [validItem],
        destination: "pantry",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/pantry"],
    });
  });

  it("invalidates grocery-lists queries on grocery_list success", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    mockApiRequest.mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          destination: "grocery_list",
          created: 3,
          groceryListId: 42,
        }),
    });

    const { result } = renderHook(() => useBatchConfirm(), { wrapper });

    await act(async () => {
      result.current.mutate({
        items: [validItem],
        destination: "grocery_list",
        groceryListId: 42,
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/meal-plan/grocery-lists"],
    });
  });

  it("sets error state on API failure", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useBatchConfirm(), { wrapper });

    await act(async () => {
      result.current.mutate({
        items: [validItem],
        destination: "daily_log",
      });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
