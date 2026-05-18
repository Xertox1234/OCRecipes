// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCatalogSearch } from "../useCatalogSearch";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { ApiError } from "../../lib/api-error";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const mockCatalogResponse = {
  results: [
    { id: 654321, title: "Online Pasta", image: "x.jpg", readyInMinutes: 25 },
  ],
  offset: 0,
  number: 20,
  totalResults: 1,
};

describe("useCatalogSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockCatalogResponse),
    });
  });

  it("routes the request to the catalog endpoint, not local search", async () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useCatalogSearch({ q: "pasta" }, true), { wrapper });

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        expect.stringContaining("/api/meal-plan/catalog/search"),
      );
    });
    // Catalog endpoint uses `query`, not the local search `q` param.
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      expect.stringContaining("query=pasta"),
    );
  });

  it("maps catalog results into SearchableRecipe shape with spoonacular ids", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useCatalogSearch({ q: "pasta" }, true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const recipes = result.current.data?.results ?? [];
    expect(recipes).toHaveLength(1);
    expect(recipes[0].id).toBe("spoonacular:654321");
    expect(recipes[0].source).toBe("spoonacular");
    expect(recipes[0].totalTimeMinutes).toBe(25);
  });

  it("does not fetch when disabled (free user or blank query)", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useCatalogSearch({ q: "pasta" }, false),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("does not fetch when params are null", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCatalogSearch(null, true), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("forwards only Spoonacular-supported filters", async () => {
    const { wrapper } = createQueryWrapper();
    renderHook(
      () =>
        useCatalogSearch(
          {
            q: "soup",
            cuisine: "Italian",
            maxPrepTime: 30,
            minProtein: 20,
            curatedOnly: true,
          },
          true,
        ),
      { wrapper },
    );

    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    const url = mockApiRequest.mock.calls[0][1] as string;
    expect(url).toContain("cuisine=Italian");
    expect(url).toContain("maxReadyTime=30");
    // Local-only filters must be dropped — the catalog endpoint rejects them.
    expect(url).not.toContain("minProtein");
    expect(url).not.toContain("curatedOnly");
  });

  it("advances pagination by the page offset", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { id: 1, title: "A" },
            { id: 2, title: "B" },
          ],
          offset: 0,
          number: 20,
          totalResults: 50,
        }),
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useCatalogSearch({ q: "pasta" }, true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(50);
    expect(result.current.hasNextPage).toBe(true);
  });

  it("surfaces a structured error when the response shape is invalid", async () => {
    // Server contract drift: `results` renamed to `items`.
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ items: [], offset: 0, number: 20, totalResults: 0 }),
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useCatalogSearch({ q: "pasta" }, true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe(
      "INVALID_RESPONSE_SHAPE",
    );
    expect(result.current.data).toBeUndefined();
  });

  it("surfaces the quota-exceeded error with its machine-readable code", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError("402: quota exceeded", "CATALOG_QUOTA_EXCEEDED"),
    );
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useCatalogSearch({ q: "pasta" }, true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe(
      "CATALOG_QUOTA_EXCEEDED",
    );
  });
});
