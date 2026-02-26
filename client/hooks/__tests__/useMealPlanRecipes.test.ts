// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useCreateMealPlanRecipe,
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

      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve("Title is required"),
      });

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
