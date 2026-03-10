// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useCookSessionQuery,
  useCreateCookSession,
  useAddCookPhoto,
  useEditIngredient,
  useDeleteIngredient,
  useCookNutrition,
  useLogCookSession,
  useCookRecipe,
  useCookSubstitutions,
} from "../useCookSession";
import { getQueryFn } from "@/lib/query-client";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest, mockGetApiUrl, mockTokenStorage, mockCompressImage } =
  vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
    mockGetApiUrl: vi.fn(() => "http://localhost:3000"),
    mockTokenStorage: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
      invalidateCache: vi.fn(),
    },
    mockCompressImage: vi.fn(),
  }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => mockGetApiUrl(),
  getQueryFn:
    () =>
    async ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const baseUrl = mockGetApiUrl();
      const url = new URL(queryKey.join("/") as string, baseUrl);
      const headers: Record<string, string> = {};
      const token = await mockTokenStorage.get();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await globalThis.fetch(url, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: mockTokenStorage,
}));

vi.mock("@/lib/image-compression", () => ({
  compressImage: (...args: unknown[]) => mockCompressImage(...args),
}));

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("useCookSession hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  //useCookSessionQuery

  describe("useCookSessionQuery", () => {
    it("returns cached data when available", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      const mockSession = {
        id: "session-1",
        ingredients: [{ id: "ing-1", name: "Tomato", quantity: "2" }],
      };

      queryClient.setQueryData(
        ["/api/cooking/sessions", "session-1"],
        mockSession,
      );

      const { result } = renderHook(() => useCookSessionQuery("session-1"), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockSession);
      });
    });

    it("fetches session from API when not cached", async () => {
      const { wrapper } = createQueryWrapper({
        defaultQueryFn: getQueryFn({ on401: "throw" }),
      });

      const mockSession = {
        id: "session-1",
        ingredients: [{ id: "ing-1", name: "Tomato", quantity: "2" }],
      };

      mockTokenStorage.get.mockResolvedValue("test-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

      const { result } = renderHook(() => useCookSessionQuery("session-1"), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: "/api/cooking/sessions/session-1",
        }),
        expect.objectContaining({
          headers: { Authorization: "Bearer test-token" },
        }),
      );
      expect(result.current.data).toEqual(mockSession);
    });

    it("is disabled when sessionId is null", () => {
      const { wrapper } = createQueryWrapper();

      const { result } = renderHook(() => useCookSessionQuery(null), {
        wrapper,
      });

      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  //useCreateCookSession

  describe("useCreateCookSession", () => {
    it("creates a new cook session via POST", async () => {
      const { wrapper } = createQueryWrapper();

      const mockSession = { id: "session-new", ingredients: [] };
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve(mockSession),
      });

      const { result } = renderHook(() => useCreateCookSession(), { wrapper });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/cooking/sessions",
      );
      expect(result.current.data).toEqual(mockSession);
    });

    it("surfaces API errors", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useCreateCookSession(), { wrapper });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("Network error");
    });
  });

  //useAddCookPhoto

  describe("useAddCookPhoto", () => {
    it("uploads compressed photo and returns detection result", async () => {
      const { wrapper } = createQueryWrapper();

      const mockResult = {
        id: "session-1",
        ingredients: [{ id: "ing-1", name: "Tomato" }],
        newDetections: 1,
      };

      mockCompressImage.mockResolvedValue({ uri: "file:///compressed.jpg" });
      mockTokenStorage.get.mockResolvedValue("test-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const { result } = renderHook(() => useAddCookPhoto(), { wrapper });

      await act(async () => {
        result.current.mutate({
          photoUri: "file:///photos/food.jpg",
          sessionId: "session-1",
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockCompressImage).toHaveBeenCalledWith(
        "file:///photos/food.jpg",
        { maxWidth: 1536, maxHeight: 1536, quality: 0.85, targetSizeKB: 4500 },
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/cooking/sessions/session-1/photos",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer test-token" },
        }),
      );
      expect(result.current.data?.newDetections).toBe(1);
    });

    it("throws on non-ok response", async () => {
      const { wrapper } = createQueryWrapper();

      mockCompressImage.mockResolvedValue({ uri: "file:///compressed.jpg" });
      mockTokenStorage.get.mockResolvedValue("token");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server error"),
      });

      const { result } = renderHook(() => useAddCookPhoto(), { wrapper });

      await act(async () => {
        result.current.mutate({
          photoUri: "file:///photos/food.jpg",
          sessionId: "session-1",
        });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("500: Server error");
    });

    it("invalidates session query on success", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      queryClient.setQueryData(["/api/cooking/sessions", "session-1"], {
        id: "session-1",
        ingredients: [],
      });

      mockCompressImage.mockResolvedValue({ uri: "file:///compressed.jpg" });
      mockTokenStorage.get.mockResolvedValue("token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "session-1",
            ingredients: [],
            newDetections: 0,
          }),
      });

      const { result } = renderHook(() => useAddCookPhoto(), { wrapper });

      await act(async () => {
        result.current.mutate({
          photoUri: "file:///photos/food.jpg",
          sessionId: "session-1",
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const queryState = queryClient.getQueryState([
        "/api/cooking/sessions",
        "session-1",
      ]);
      expect(queryState?.isInvalidated).toBe(true);
    });

    it("omits Authorization header when no token", async () => {
      const { wrapper } = createQueryWrapper();

      mockCompressImage.mockResolvedValue({ uri: "file:///compressed.jpg" });
      mockTokenStorage.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ id: "s1", ingredients: [], newDetections: 0 }),
      });

      const { result } = renderHook(() => useAddCookPhoto(), { wrapper });

      await act(async () => {
        result.current.mutate({
          photoUri: "file:///photos/food.jpg",
          sessionId: "session-1",
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: {} }),
      );
    });
  });

  //useEditIngredient

  describe("useEditIngredient", () => {
    it("patches ingredient via API", async () => {
      const { wrapper } = createQueryWrapper();

      const mockResult = {
        ingredient: { id: "ing-1", name: "Roma Tomato", quantity: "3" },
      };
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve(mockResult),
      });

      const { result } = renderHook(() => useEditIngredient("session-1"), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({
          ingredientId: "ing-1",
          updates: { name: "Roma Tomato", quantity: 3 },
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "PATCH",
        "/api/cooking/sessions/session-1/ingredients/ing-1",
        { name: "Roma Tomato", quantity: 3 },
      );
    });

    it("invalidates session query on success", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      queryClient.setQueryData(["/api/cooking/sessions", "session-1"], {
        id: "session-1",
        ingredients: [],
      });

      mockApiRequest.mockResolvedValue({
        json: () =>
          Promise.resolve({ ingredient: { id: "ing-1", name: "Updated" } }),
      });

      const { result } = renderHook(() => useEditIngredient("session-1"), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({
          ingredientId: "ing-1",
          updates: { name: "Updated" },
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const queryState = queryClient.getQueryState([
        "/api/cooking/sessions",
        "session-1",
      ]);
      expect(queryState?.isInvalidated).toBe(true);
    });

    it("throws when sessionId is null", async () => {
      const { wrapper } = createQueryWrapper();

      const { result } = renderHook(() => useEditIngredient(null), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({
          ingredientId: "ing-1",
          updates: { name: "Test" },
        });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("No active session");
    });
  });

  //useDeleteIngredient

  describe("useDeleteIngredient", () => {
    it("deletes ingredient via API", async () => {
      const { wrapper } = createQueryWrapper();

      const mockResult = { ingredients: [] };
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve(mockResult),
      });

      const { result } = renderHook(() => useDeleteIngredient("session-1"), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate("ing-1");
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/cooking/sessions/session-1/ingredients/ing-1",
      );
    });

    it("invalidates session query on success", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      queryClient.setQueryData(["/api/cooking/sessions", "session-1"], {
        id: "session-1",
        ingredients: [{ id: "ing-1" }],
      });

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ ingredients: [] }),
      });

      const { result } = renderHook(() => useDeleteIngredient("session-1"), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate("ing-1");
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const queryState = queryClient.getQueryState([
        "/api/cooking/sessions",
        "session-1",
      ]);
      expect(queryState?.isInvalidated).toBe(true);
    });

    it("throws when sessionId is null", async () => {
      const { wrapper } = createQueryWrapper();

      const { result } = renderHook(() => useDeleteIngredient(null), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate("ing-1");
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("No active session");
    });
  });

  //useCookNutrition

  describe("useCookNutrition", () => {
    it("fetches nutrition summary for session", async () => {
      const { wrapper } = createQueryWrapper();

      const mockNutrition = {
        totalCalories: 450,
        totalProtein: 30,
        totalCarbs: 50,
        totalFat: 15,
        ingredients: [],
      };
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve(mockNutrition),
      });

      const { result } = renderHook(() => useCookNutrition("session-1"), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({ cookingMethod: "grilled" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/cooking/sessions/session-1/nutrition",
        { cookingMethod: "grilled" },
      );
      expect(result.current.data).toEqual(mockNutrition);
    });

    it("throws when sessionId is null", async () => {
      const { wrapper } = createQueryWrapper();

      const { result } = renderHook(() => useCookNutrition(null), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({});
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("No active session");
    });
  });

  //useLogCookSession

  describe("useLogCookSession", () => {
    it("logs session with meal type and date", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ success: true }),
      });

      const { result } = renderHook(() => useLogCookSession("session-1"), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({ mealType: "dinner", date: "2026-03-10" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/cooking/sessions/session-1/log",
        { mealType: "dinner", date: "2026-03-10" },
      );
    });

    it("throws when sessionId is null", async () => {
      const { wrapper } = createQueryWrapper();

      const { result } = renderHook(() => useLogCookSession(null), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({});
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("No active session");
    });
  });

  //useCookRecipe

  describe("useCookRecipe", () => {
    it("generates recipe from session ingredients", async () => {
      const { wrapper } = createQueryWrapper();

      const mockRecipe = {
        title: "Grilled Vegetables",
        instructions: ["Step 1", "Step 2"],
        ingredients: [],
      };
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve(mockRecipe),
      });

      const { result } = renderHook(() => useCookRecipe("session-1"), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/cooking/sessions/session-1/recipe",
      );
      expect(result.current.data).toEqual(mockRecipe);
    });

    it("throws when sessionId is null", async () => {
      const { wrapper } = createQueryWrapper();

      const { result } = renderHook(() => useCookRecipe(null), { wrapper });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("No active session");
    });
  });

  //useCookSubstitutions

  describe("useCookSubstitutions", () => {
    it("fetches substitutions for specified ingredients", async () => {
      const { wrapper } = createQueryWrapper();

      const mockSubs = {
        substitutions: [
          {
            ingredientId: "ing-1",
            original: "Butter",
            suggestion: "Olive oil",
          },
        ],
      };
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve(mockSubs),
      });

      const { result } = renderHook(() => useCookSubstitutions("session-1"), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({ ingredientIds: ["ing-1"] });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/cooking/sessions/session-1/substitutions",
        { ingredientIds: ["ing-1"] },
      );
      expect(result.current.data).toEqual(mockSubs);
    });

    it("throws when sessionId is null", async () => {
      const { wrapper } = createQueryWrapper();

      const { result } = renderHook(() => useCookSubstitutions(null), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate({});
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("No active session");
    });
  });
});
