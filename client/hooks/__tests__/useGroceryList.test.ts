// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useGroceryLists,
  useGroceryListDetail,
  useCreateGroceryList,
  useToggleGroceryItem,
  useAddManualGroceryItem,
  useDeleteGroceryList,
  useAddGroceryItemToPantry,
} from "../useGroceryList";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { ApiError } from "@/lib/api-error";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

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

describe("useGroceryLists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached grocery lists", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const lists = [
      { id: 1, title: "Week 1" },
      { id: 2, title: "Week 2" },
    ];
    queryClient.setQueryData(["/api/meal-plan/grocery-lists"], lists);

    const { result } = renderHook(() => useGroceryLists(), { wrapper });
    expect(result.current.data).toEqual(lists);
  });

  it("returns undefined when not cached", () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useGroceryLists(), { wrapper });
    expect(result.current.data).toBeUndefined();
  });
});

describe("useGroceryListDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached list detail", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const detail = makeListData([{ id: 10, name: "Milk", isChecked: false }]);
    queryClient.setQueryData(["/api/meal-plan/grocery-lists", 1], detail);

    const { result } = renderHook(() => useGroceryListDetail(1), { wrapper });
    expect(result.current.data).toEqual(detail);
  });

  it("is disabled when listId is 0", () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useGroceryListDetail(0), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("throws an ApiError with code NOT_FOUND on a 404", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const { result } = renderHook(() => useGroceryListDetail(1), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const err = result.current.error;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("NOT_FOUND");
  });

  it("throws an ApiError without NOT_FOUND on a transient 5xx", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useGroceryListDetail(1), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const err = result.current.error;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).not.toBe("NOT_FOUND");
  });
});

describe("useCreateGroceryList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls POST and invalidates lists on success", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 1,
          title: "Week 1",
          items: [],
        }),
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateGroceryList(), { wrapper });

    await act(async () => {
      result.current.mutate({
        startDate: "2024-01-01",
        endDate: "2024-01-07",
        title: "Week 1",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/meal-plan/grocery-lists",
      { startDate: "2024-01-01", endDate: "2024-01-07", title: "Week 1" },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/meal-plan/grocery-lists"],
    });
  });

  it("throws on non-ok response", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve("Invalid dates"),
    });

    const { result } = renderHook(() => useCreateGroceryList(), { wrapper });

    await act(async () => {
      result.current.mutate({ startDate: "bad", endDate: "bad" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("422: Invalid dates");
  });
});

describe("useDeleteGroceryList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls DELETE and invalidates lists on success", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({ ok: true, status: 204 });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteGroceryList(), { wrapper });

    await act(async () => {
      result.current.mutate(5);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "DELETE",
      "/api/meal-plan/grocery-lists/5",
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/meal-plan/grocery-lists"],
    });
  });
});

describe("useAddManualGroceryItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls POST with item data and invalidates list", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 1, name: "Butter" }),
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAddManualGroceryItem(), { wrapper });

    await act(async () => {
      result.current.mutate({
        listId: 3,
        name: "Butter",
        quantity: "1",
        unit: "stick",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/meal-plan/grocery-lists/3/items",
      { name: "Butter", quantity: "1", unit: "stick", category: undefined },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/meal-plan/grocery-lists", 3],
    });
  });
});

describe("useAddGroceryItemToPantry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls POST and invalidates list + pantry queries", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 1 }),
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAddGroceryItemToPantry(), {
      wrapper,
    });

    await act(async () => {
      result.current.mutate({ listId: 2, itemId: 10 });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/meal-plan/grocery-lists/2/items/10/add-to-pantry",
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/meal-plan/grocery-lists", 2],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/pantry"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/pantry/expiring"],
    });
  });
});

describe("useToggleGroceryItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically toggles item checked state", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

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
    const { wrapper, queryClient } = createQueryWrapper();

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
    const { wrapper, queryClient } = createQueryWrapper();

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
    const { wrapper, queryClient } = createQueryWrapper();

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
