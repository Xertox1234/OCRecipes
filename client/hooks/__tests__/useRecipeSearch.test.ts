// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRecipeSearch } from "../useRecipeSearch";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const mockResponse = {
  results: [
    {
      id: "personal:1",
      source: "personal",
      userId: "1",
      title: "Test Recipe",
      description: null,
      ingredients: [],
      cuisine: null,
      dietTags: [],
      mealTypes: [],
      difficulty: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      totalTimeMinutes: null,
      caloriesPerServing: null,
      proteinPerServing: null,
      carbsPerServing: null,
      fatPerServing: null,
      servings: null,
      imageUrl: null,
      sourceUrl: null,
      createdAt: null,
    },
  ],
  total: 1,
  offset: 0,
  limit: 20,
  query: { q: "test", filters: {}, sort: "relevance" },
};

describe("useRecipeSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
  });

  it("fetches search results", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRecipeSearch({ q: "test" }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toHaveLength(1);
  });

  it("builds query string from params", async () => {
    const { wrapper } = createQueryWrapper();
    renderHook(
      () =>
        useRecipeSearch({
          q: "pasta",
          cuisine: "Italian",
          sort: "newest",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        expect.stringContaining("q=pasta"),
      );
    });
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      expect.stringContaining("cuisine=Italian"),
    );
  });

  it("does not fetch when params are null", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRecipeSearch(null), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});
