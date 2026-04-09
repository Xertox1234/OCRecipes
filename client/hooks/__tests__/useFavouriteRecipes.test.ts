// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";

import {
  useFavouriteRecipes,
  useFavouriteRecipeIds,
  useIsRecipeFavourited,
} from "../useFavouriteRecipes";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useFavouriteRecipes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useFavouriteRecipes", () => {
    it("fetches resolved favourites successfully", async () => {
      const { wrapper } = createQueryWrapper();

      const mockData = [
        {
          recipeId: 10,
          recipeType: "mealPlan" as const,
          title: "Pasta Carbonara",
          description: "Classic Roman pasta",
          imageUrl: null,
          servings: 4,
          difficulty: "Medium",
          favouritedAt: new Date().toISOString(),
        },
      ];

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const { result } = renderHook(() => useFavouriteRecipes(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].title).toBe("Pasta Carbonara");
      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        "/api/favourite-recipes",
      );
    });

    it("fetches with limit param when provided", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const { result } = renderHook(() => useFavouriteRecipes(5), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        "/api/favourite-recipes?limit=5",
      );
    });
  });

  describe("useFavouriteRecipeIds", () => {
    it("fetches favourite IDs successfully", async () => {
      const { wrapper } = createQueryWrapper();

      const mockIds = {
        ids: [
          { recipeId: 10, recipeType: "mealPlan" },
          { recipeId: 20, recipeType: "community" },
        ],
      };

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockIds),
      });

      const { result } = renderHook(() => useFavouriteRecipeIds(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.ids).toHaveLength(2);
      expect(result.current.data?.ids[0].recipeId).toBe(10);
      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        "/api/favourite-recipes/ids",
      );
    });
  });

  describe("useIsRecipeFavourited", () => {
    it("returns true when recipe is in favourites", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      queryClient.setQueryData(["/api/favourite-recipes/ids"], {
        ids: [
          { recipeId: 10, recipeType: "mealPlan" },
          { recipeId: 20, recipeType: "community" },
        ],
      });

      const { result } = renderHook(
        () => useIsRecipeFavourited(10, "mealPlan"),
        { wrapper },
      );

      expect(result.current).toBe(true);
    });

    it("returns false when recipe is not in favourites", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      queryClient.setQueryData(["/api/favourite-recipes/ids"], {
        ids: [{ recipeId: 20, recipeType: "community" }],
      });

      const { result } = renderHook(
        () => useIsRecipeFavourited(10, "mealPlan"),
        { wrapper },
      );

      expect(result.current).toBe(false);
    });

    it("returns false when ids data is not yet loaded", () => {
      const { wrapper } = createQueryWrapper();

      const { result } = renderHook(
        () => useIsRecipeFavourited(10, "mealPlan"),
        { wrapper },
      );

      expect(result.current).toBe(false);
    });

    it("returns false when recipeType does not match", () => {
      const { wrapper, queryClient } = createQueryWrapper();

      queryClient.setQueryData(["/api/favourite-recipes/ids"], {
        ids: [{ recipeId: 10, recipeType: "community" }],
      });

      const { result } = renderHook(
        () => useIsRecipeFavourited(10, "mealPlan"),
        { wrapper },
      );

      expect(result.current).toBe(false);
    });
  });
});
