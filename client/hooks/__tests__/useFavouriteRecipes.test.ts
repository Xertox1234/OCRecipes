// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";

import {
  useFavouriteRecipes,
  useFavouriteRecipeIds,
  useIsRecipeFavourited,
  useToggleFavouriteRecipe,
  useShareRecipe,
} from "../useFavouriteRecipes";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest, mockAlert, mockShare, mockPlatform } = vi.hoisted(
  () => ({
    mockApiRequest: vi.fn(),
    mockAlert: { alert: vi.fn() },
    mockShare: { share: vi.fn() },
    mockPlatform: { OS: "ios" as string },
  }),
);

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("react-native", async () => {
  return {
    Alert: mockAlert,
    Share: mockShare,
    Platform: mockPlatform,
  };
});

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

  describe("useToggleFavouriteRecipe", () => {
    it("optimistically adds recipe to favourites on toggle", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      queryClient.setQueryData(["/api/favourite-recipes/ids"], {
        ids: [],
      });

      mockApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ favourited: true }),
      });

      const { result } = renderHook(() => useToggleFavouriteRecipe(), {
        wrapper,
      });

      act(() => {
        result.current.mutate({ recipeId: 10, recipeType: "mealPlan" });
      });

      // Optimistic update should add the id immediately
      await waitFor(() => {
        const data = queryClient.getQueryData<{
          ids: { recipeId: number; recipeType: string }[];
        }>(["/api/favourite-recipes/ids"]);
        expect(
          data?.ids.some(
            (f) => f.recipeId === 10 && f.recipeType === "mealPlan",
          ),
        ).toBe(true);
      });
    });

    it("optimistically removes recipe from favourites on toggle", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      queryClient.setQueryData(["/api/favourite-recipes/ids"], {
        ids: [{ recipeId: 10, recipeType: "mealPlan" }],
      });

      mockApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ favourited: false }),
      });

      const { result } = renderHook(() => useToggleFavouriteRecipe(), {
        wrapper,
      });

      act(() => {
        result.current.mutate({ recipeId: 10, recipeType: "mealPlan" });
      });

      // Optimistic update should remove the id immediately
      await waitFor(() => {
        const data = queryClient.getQueryData<{
          ids: { recipeId: number; recipeType: string }[];
        }>(["/api/favourite-recipes/ids"]);
        expect(
          data?.ids.some(
            (f) => f.recipeId === 10 && f.recipeType === "mealPlan",
          ),
        ).toBe(false);
      });
    });

    it("rolls back optimistic update on error", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      const originalIds = [{ recipeId: 10, recipeType: "mealPlan" }];
      queryClient.setQueryData(["/api/favourite-recipes/ids"], {
        ids: originalIds,
      });

      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal error" }),
        text: () => Promise.resolve("Internal error"),
      });

      const { result } = renderHook(() => useToggleFavouriteRecipe(), {
        wrapper,
      });

      act(() => {
        result.current.mutate({ recipeId: 10, recipeType: "mealPlan" });
      });

      // Wait for the mutation to settle — rollback should restore original
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      const data = queryClient.getQueryData<{
        ids: { recipeId: number; recipeType: string }[];
      }>(["/api/favourite-recipes/ids"]);
      expect(data?.ids).toEqual(originalIds);
    });

    it("shows LIMIT_REACHED alert on 403 with code", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      queryClient.setQueryData(["/api/favourite-recipes/ids"], {
        ids: [],
      });

      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({
            error: "Limit reached",
            code: "LIMIT_REACHED",
          }),
      });

      const { result } = renderHook(() => useToggleFavouriteRecipe(), {
        wrapper,
      });

      act(() => {
        result.current.mutate({ recipeId: 10, recipeType: "mealPlan" });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(mockAlert.alert).toHaveBeenCalledWith(
        "Favourites Limit Reached",
        "Upgrade to premium for unlimited favourites.",
      );
    });
  });

  describe("useShareRecipe", () => {
    it("calls Share.share with formatted message on iOS", async () => {
      mockPlatform.OS = "ios";

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            title: "Pasta Carbonara",
            description: "Classic Roman pasta",
            imageUrl: "https://example.com/pasta.jpg",
            deepLink: "ocrecipes://recipe/10?type=community",
          }),
      });

      mockShare.share.mockResolvedValue({ action: "sharedAction" });

      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useShareRecipe(), { wrapper });

      await act(async () => {
        await result.current.share(10, "community");
      });

      expect(mockShare.share).toHaveBeenCalledWith({
        title: "Pasta Carbonara",
        message: expect.stringContaining("Pasta Carbonara"),
        url: "https://example.com/pasta.jpg",
      });
    });

    it("omits url field on Android", async () => {
      mockPlatform.OS = "android";

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            title: "Pasta Carbonara",
            description: "Classic Roman pasta",
            imageUrl: "https://example.com/pasta.jpg",
            deepLink: "ocrecipes://recipe/10?type=community",
          }),
      });

      mockShare.share.mockResolvedValue({ action: "sharedAction" });

      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useShareRecipe(), { wrapper });

      await act(async () => {
        await result.current.share(10, "community");
      });

      expect(mockShare.share).toHaveBeenCalledWith({
        title: "Pasta Carbonara",
        message: expect.stringContaining("Pasta Carbonara"),
      });
      // Should NOT have url key on Android
      const shareCall = mockShare.share.mock.calls[0][0];
      expect(shareCall).not.toHaveProperty("url");
    });

    it("silently ignores user-cancelled share", async () => {
      mockPlatform.OS = "ios";

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            title: "Pasta",
            description: "",
            imageUrl: null,
            deepLink: "ocrecipes://recipe/10",
          }),
      });

      mockShare.share.mockRejectedValue(new Error("User did not share"));

      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useShareRecipe(), { wrapper });

      await act(async () => {
        await result.current.share(10, "community");
      });

      // Should NOT show alert for user cancellation
      expect(mockAlert.alert).not.toHaveBeenCalled();
    });

    it("shows alert on share failure", async () => {
      mockPlatform.OS = "ios";

      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server error"),
      });

      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useShareRecipe(), { wrapper });

      await act(async () => {
        await result.current.share(10, "community");
      });

      expect(mockAlert.alert).toHaveBeenCalledWith(
        "Share Failed",
        "Could not share this recipe.",
      );
    });
  });
});
