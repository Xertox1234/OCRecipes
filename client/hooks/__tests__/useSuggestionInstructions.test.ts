// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { useSuggestionInstructions } from "../useSuggestionInstructions";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useSuggestionInstructions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch when enabled is false", () => {
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () =>
        useSuggestionInstructions({
          itemId: 1,
          suggestionIndex: 0,
          suggestionTitle: "Test Recipe",
          suggestionType: "recipe",
          enabled: false,
        }),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("fetches instructions when enabled", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ instructions: "Step 1: Preheat oven to 350F" }),
    });

    const { result } = renderHook(
      () =>
        useSuggestionInstructions({
          itemId: 5,
          suggestionIndex: 2,
          suggestionTitle: "Baked Apple",
          suggestionType: "recipe",
          cacheId: 10,
          enabled: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.instructions).toBe(
      "Step 1: Preheat oven to 350F",
    );
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/items/5/suggestions/2/instructions",
      { suggestionTitle: "Baked Apple", suggestionType: "recipe", cacheId: 10 },
    );
  });

  it("includes cacheId in the query key", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const mockData = { instructions: "cached" };
    queryClient.setQueryData(
      ["/api/items/1/suggestions/0/instructions", "Test", "recipe", 42],
      mockData,
    );

    const { result } = renderHook(
      () =>
        useSuggestionInstructions({
          itemId: 1,
          suggestionIndex: 0,
          suggestionTitle: "Test",
          suggestionType: "recipe",
          cacheId: 42,
          enabled: true,
        }),
      { wrapper },
    );

    expect(result.current.data).toEqual(mockData);
  });

  it("does not serve one suggestionType's cached instructions to another", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockImplementation(
      (_method: string, _url: string, body: { suggestionType: string }) =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ instructions: `${body.suggestionType} steps` }),
        }),
    );
    const params = {
      itemId: 1,
      suggestionIndex: 0,
      suggestionTitle: "Test",
      cacheId: 42,
      enabled: true,
    };

    const first = renderHook(
      () => useSuggestionInstructions({ ...params, suggestionType: "recipe" }),
      { wrapper },
    );
    await waitFor(() => {
      expect(first.result.current.data?.instructions).toBe("recipe steps");
    });

    const second = renderHook(
      () => useSuggestionInstructions({ ...params, suggestionType: "craft" }),
      { wrapper },
    );
    await waitFor(() => {
      expect(second.result.current.data?.instructions).toBe("craft steps");
    });
    expect(mockApiRequest).toHaveBeenCalledTimes(2);
  });
});
