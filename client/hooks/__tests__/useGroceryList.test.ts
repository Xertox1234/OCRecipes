// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useToggleGroceryItem } from "../useGroceryList";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      ),
  };
}

const makeListData = (
  items: { id: number; name: string; isChecked: boolean }[],
) => ({
  id: 1,
  userId: "user1",
  title: "Test List",
  startDate: "2024-01-01",
  endDate: "2024-01-07",
  createdAt: "2024-01-01",
  items,
});

describe("useToggleGroceryItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically toggles item checked state", async () => {
    const { wrapper, queryClient } = createWrapper();

    const items = [
      { id: 10, name: "Milk", isChecked: false },
      { id: 20, name: "Eggs", isChecked: false },
    ];
    queryClient.setQueryData(
      ["/api/meal-plan/grocery-lists", 1],
      makeListData(items),
    );

    // Keep API pending to inspect optimistic state
    mockApiRequest.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useToggleGroceryItem(), { wrapper });

    act(() => {
      result.current.mutate({ listId: 1, itemId: 10, isChecked: true });
    });

    await waitFor(() => {
      const data = queryClient.getQueryData<ReturnType<typeof makeListData>>([
        "/api/meal-plan/grocery-lists",
        1,
      ]);
      const milk = data?.items.find((i) => i.id === 10);
      expect(milk?.isChecked).toBe(true);
      // Other item unchanged
      const eggs = data?.items.find((i) => i.id === 20);
      expect(eggs?.isChecked).toBe(false);
    });
  });

  it("rolls back on API error", async () => {
    const { wrapper, queryClient } = createWrapper();

    const items = [{ id: 10, name: "Milk", isChecked: false }];
    queryClient.setQueryData(
      ["/api/meal-plan/grocery-lists", 1],
      makeListData(items),
    );

    mockApiRequest.mockRejectedValue(new Error("Server error"));

    const { result } = renderHook(() => useToggleGroceryItem(), { wrapper });

    await act(async () => {
      result.current.mutate({ listId: 1, itemId: 10, isChecked: true });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Should be rolled back
    const data = queryClient.getQueryData<ReturnType<typeof makeListData>>([
      "/api/meal-plan/grocery-lists",
      1,
    ]);
    expect(data?.items[0].isChecked).toBe(false);
  });

  it("calls the correct API endpoint", async () => {
    const { wrapper, queryClient } = createWrapper();

    queryClient.setQueryData(
      ["/api/meal-plan/grocery-lists", 5],
      makeListData([{ id: 30, name: "Bread", isChecked: false }]),
    );

    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 30, name: "Bread", isChecked: true }),
    });

    const { result } = renderHook(() => useToggleGroceryItem(), { wrapper });

    await act(async () => {
      result.current.mutate({ listId: 5, itemId: 30, isChecked: true });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "PUT",
      "/api/meal-plan/grocery-lists/5/items/30",
      { isChecked: true },
    );
  });

  it("invalidates list query on settled", async () => {
    const { wrapper, queryClient } = createWrapper();

    queryClient.setQueryData(
      ["/api/meal-plan/grocery-lists", 1],
      makeListData([{ id: 10, name: "Milk", isChecked: false }]),
    );

    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 10, name: "Milk", isChecked: true }),
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useToggleGroceryItem(), { wrapper });

    await act(async () => {
      result.current.mutate({ listId: 1, itemId: 10, isChecked: true });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/meal-plan/grocery-lists", 1],
    });
  });
});
