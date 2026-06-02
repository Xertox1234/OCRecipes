// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useUnifiedRecipes,
  useMealPlanRecipeDetail,
  useCreateMealPlanRecipe,
  useCatalogSearch,
  useSaveCatalogRecipe,
  useImportRecipeFromUrl,
} from "../useMealPlanRecipes";
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

  describe("useCatalogSearch", () => {
    it("is disabled when params is null", () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useCatalogSearch(null), { wrapper });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("is disabled when query is empty", () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useCatalogSearch({ query: "" }), {
        wrapper,
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches with correct query params", async () => {
      const { wrapper } = createQueryWrapper();
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [],
            offset: 0,
            number: 10,
            totalResults: 0,
          }),
      });

      const { result } = renderHook(
        () => useCatalogSearch({ query: "chicken", cuisine: "Mexican" }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        expect.stringContaining("query=chicken"),
      );
      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        expect.stringContaining("cuisine=Mexican"),
      );
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

  describe("useSaveCatalogRecipe", () => {
    it("calls correct endpoint with spoonacular ID and invalidates queries", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 5, title: "Saved Recipe" }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useSaveCatalogRecipe(), { wrapper });

      await act(async () => {
        result.current.mutate(12345);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/meal-plan/catalog/12345/save",
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/meal-plan/recipes"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/recipes/browse"],
      });
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
});
