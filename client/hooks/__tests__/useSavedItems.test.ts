// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useCreateSavedItem, useDeleteSavedItem } from "../useSavedItems";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest, mockGetApiUrl, mockTokenStorage, mockFetch } =
  vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
    mockGetApiUrl: vi.fn(() => "http://localhost:3000"),
    mockTokenStorage: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
      invalidateCache: vi.fn(),
    },
    mockFetch: vi.fn(),
  }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => mockGetApiUrl(),
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: mockTokenStorage,
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("useCreateSavedItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates saved item and invalidates queries on success", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    mockTokenStorage.get.mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ id: 1, productName: "Apple", userId: "user1" }),
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateSavedItem(), { wrapper });

    await act(async () => {
      result.current.mutate({
        type: "recipe",
        title: "Apple Pie Recipe",
        sourceProductName: "Apple",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({
      limitReached: false,
      item: { id: 1, productName: "Apple", userId: "user1" },
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/saved-items"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/saved-items/count"],
    });
  });

  it("returns limitReached when 403 with LIMIT_REACHED error", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    mockTokenStorage.get.mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: "LIMIT_REACHED" }),
    });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateSavedItem(), { wrapper });

    await act(async () => {
      result.current.mutate({
        type: "activity",
        title: "Extra Item",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ limitReached: true });
    // Should NOT invalidate on limit reached
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("throws on 403 with non-LIMIT_REACHED error", async () => {
    const { wrapper } = createQueryWrapper();

    mockTokenStorage.get.mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({ error: "FORBIDDEN", message: "Not allowed" }),
    });

    const { result } = renderHook(() => useCreateSavedItem(), { wrapper });

    await act(async () => {
      result.current.mutate({
        type: "recipe",
        title: "Test Item",
      });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("Not allowed");
  });

  it("throws on non-ok non-403 response", async () => {
    const { wrapper } = createQueryWrapper();

    mockTokenStorage.get.mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const { result } = renderHook(() => useCreateSavedItem(), { wrapper });

    await act(async () => {
      result.current.mutate({
        type: "recipe",
        title: "Test Item",
      });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("500: Internal Server Error");
  });

  it("sends auth header when token exists", async () => {
    const { wrapper } = createQueryWrapper();

    mockTokenStorage.get.mockResolvedValue("my-token");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1 }),
    });

    const { result } = renderHook(() => useCreateSavedItem(), { wrapper });

    await act(async () => {
      result.current.mutate({
        type: "recipe",
        title: "Apple Pie Recipe",
        sourceProductName: "Apple",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer my-token");
  });

  it("omits auth header when no token", async () => {
    const { wrapper } = createQueryWrapper();

    mockTokenStorage.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1 }),
    });

    const { result } = renderHook(() => useCreateSavedItem(), { wrapper });

    await act(async () => {
      result.current.mutate({
        type: "recipe",
        title: "Apple Pie Recipe",
        sourceProductName: "Apple",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });
});

describe("useDeleteSavedItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls DELETE endpoint and invalidates queries", async () => {
    const { wrapper, queryClient } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({});
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteSavedItem(), { wrapper });

    await act(async () => {
      result.current.mutate(5);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockApiRequest).toHaveBeenCalledWith("DELETE", "/api/saved-items/5");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/saved-items"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/saved-items/count"],
    });
  });
});
