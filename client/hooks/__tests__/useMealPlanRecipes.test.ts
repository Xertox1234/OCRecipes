// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useUnifiedRecipes,
  useMealPlanRecipeDetail,
  useCreateMealPlanRecipe,
  useImportRecipeFromUrl,
  useParseRecipeFromPage,
  useParseRecipeFromUrl,
} from "../useMealPlanRecipes";
import { onlineManager } from "@tanstack/react-query";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useMealPlanRecipes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useUnifiedRecipes", () => {
    it("returns cached data without params", () => {
      const { wrapper, queryClient } = createQueryWrapper();
      const data = { community: [], personal: [{ id: 1, title: "My Recipe" }] };
      queryClient.setQueryData(["/api/recipes/browse", {}], data);

      const { result } = renderHook(() => useUnifiedRecipes(), { wrapper });
      expect(result.current.data).toEqual(data);
    });

    it("returns cached data with query params", () => {
      const { wrapper, queryClient } = createQueryWrapper();
      const params = { query: "pasta", cuisine: "Italian" };
      const data = {
        community: [{ id: 1, title: "Community Pasta" }],
        personal: [],
      };
      queryClient.setQueryData(["/api/recipes/browse", params], data);

      const { result } = renderHook(() => useUnifiedRecipes(params), {
        wrapper,
      });
      expect(result.current.data).toEqual(data);
    });

    it("fetches with correct URL containing query string", async () => {
      const { wrapper } = createQueryWrapper();
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ community: [], personal: [] }),
      });

      const { result } = renderHook(
        () => useUnifiedRecipes({ query: "tacos" }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        expect.stringContaining("/api/recipes/browse?query=tacos"),
      );
    });

    // Perf audit 2026-11-08 L3: each debounced search term is a new query
    // key; without placeholder data the list emptied to the loading skeleton
    // on every term while the next page fetched.
    it("keeps the previous term's results while the next term loads", async () => {
      const { wrapper, queryClient } = createQueryWrapper();
      const previous = {
        community: [],
        personal: [{ id: 1, title: "Oats" }],
        frequent: [],
      };
      queryClient.setQueryData(
        ["/api/recipes/browse", { query: "o" }],
        previous,
      );
      mockApiRequest.mockReturnValue(new Promise(() => {})); // never settles

      const { result, rerender } = renderHook(
        ({ query }) => useUnifiedRecipes({ query }),
        { wrapper, initialProps: { query: "o" } },
      );
      expect(result.current.data).toEqual(previous);

      rerender({ query: "oa" });
      expect(result.current.data).toEqual(previous);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("useMealPlanRecipeDetail", () => {
    it("returns cached recipe detail", () => {
      const { wrapper, queryClient } = createQueryWrapper();
      const detail = { id: 5, title: "Pasta", ingredients: [] };
      queryClient.setQueryData(["/api/meal-plan/recipes", 5], detail);

      const { result } = renderHook(() => useMealPlanRecipeDetail(5), {
        wrapper,
      });
      expect(result.current.data).toEqual(detail);
    });

    it("is disabled when recipeId is 0", () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useMealPlanRecipeDetail(0), {
        wrapper,
      });
      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("useCreateMealPlanRecipe", () => {
    it("calls POST endpoint with recipe data", async () => {
      const { wrapper } = createQueryWrapper();

      const recipe = { title: "Pasta", servings: 4 };

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, ...recipe }),
      });

      const { result } = renderHook(() => useCreateMealPlanRecipe(), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate(recipe);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/meal-plan/recipes",
        recipe,
      );
    });

    it("invalidates recipes and browse queries on success", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, title: "Pasta" }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useCreateMealPlanRecipe(), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({ title: "Pasta" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/meal-plan/recipes"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/recipes/browse"],
      });
    });

    it("throws on non-ok response with error text", async () => {
      const { wrapper } = createQueryWrapper();

      // apiRequest throws on non-ok before returning, so the mock rejects
      // (matching production) rather than resolving a non-ok response.
      mockApiRequest.mockRejectedValue(new Error("422: Title is required"));

      const { result } = renderHook(() => useCreateMealPlanRecipe(), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({ title: "" });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("422: Title is required");
    });
  });

  describe("useImportRecipeFromUrl", () => {
    it("calls import endpoint with URL", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 10, title: "Imported Recipe" }),
      });

      const { result } = renderHook(() => useImportRecipeFromUrl(), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate("https://example.com/recipe");
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/meal-plan/recipes/import-url",
        { url: "https://example.com/recipe" },
      );
    });

    it("invalidates recipes and browse on success", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 10 }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useImportRecipeFromUrl(), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate("https://example.com/recipe");
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/meal-plan/recipes"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/recipes/browse"],
      });
    });
  });

  // Reliability audit 2026-11-19 L-crel-2: with the default networkMode
  // "online", an offline import paused forever (spinner stuck, no timeout)
  // and then fired on reconnect for a screen already gone. Fail fast instead.
  describe("recipe parse while offline", () => {
    afterEach(() => {
      onlineManager.setOnline(true);
    });

    async function offlineRejection(
      run: () => Promise<unknown>,
    ): Promise<unknown> {
      let caught: unknown;
      await act(async () => {
        caught = await run().catch((e: unknown) => e);
      });
      return caught;
    }

    it("useParseRecipeFromPage rejects with an OfflineError and sends nothing", async () => {
      onlineManager.setOnline(false);
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useParseRecipeFromPage(), {
        wrapper,
      });
      const caught = await offlineRejection(() =>
        result.current.mutateAsync({ url: "https://a.test", ldJson: ["{}"] }),
      );
      expect(caught).toMatchObject({ name: "OfflineError" });
      expect(mockApiRequest).not.toHaveBeenCalled();
    });

    it("useParseRecipeFromUrl rejects with an OfflineError and sends nothing", async () => {
      onlineManager.setOnline(false);
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useParseRecipeFromUrl(), {
        wrapper,
      });
      const caught = await offlineRejection(() =>
        result.current.mutateAsync("https://a.test"),
      );
      expect(caught).toMatchObject({ name: "OfflineError" });
      expect(mockApiRequest).not.toHaveBeenCalled();
    });
  });
});
