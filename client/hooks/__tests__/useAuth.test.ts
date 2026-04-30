// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useAuth } from "../useAuth";

// Create mock storage and functions that survive vi.mock hoisting
const {
  mockAsyncStorage,
  mockTokenStorage,
  mockApiRequest,
  mockGetApiUrl,
  mockFetch,
} = vi.hoisted(() => {
  const mockAsyncStorage: Record<string, string> = {};
  return {
    mockAsyncStorage,
    mockTokenStorage: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
      invalidateCache: vi.fn(),
    },
    mockApiRequest: vi.fn(),
    mockGetApiUrl: vi.fn(() => "http://localhost:3000"),
    mockFetch: vi.fn(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) =>
      Promise.resolve(mockAsyncStorage[key] ?? null),
    ),
    setItem: vi.fn((key: string, value: string) => {
      mockAsyncStorage[key] = value;
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      delete mockAsyncStorage[key];
      return Promise.resolve();
    }),
  },
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: mockTokenStorage,
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => mockGetApiUrl(),
}));

vi.mock("@/lib/push-token-registration", () => ({
  registerPushToken: vi.fn().mockResolvedValue(null),
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const fakeUser = { id: 1, username: "testuser", createdAt: "2024-01-01" };

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockAsyncStorage).forEach((k) => delete mockAsyncStorage[k]);
  });

  describe("checkAuth", () => {
    it("sets unauthenticated state when no token exists", async () => {
      mockTokenStorage.get.mockResolvedValue(null);

      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("authenticates with valid token and caches user", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(fakeUser);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/auth/me",
        {
          headers: { Authorization: "Bearer valid-token" },
        },
      );
      expect(mockAsyncStorage["@ocrecipes_auth"]).toBe(
        JSON.stringify(fakeUser),
      );
    });

    it("clears token on invalid/expired token (non-ok response)", async () => {
      mockTokenStorage.get.mockResolvedValue("expired-token");
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(mockTokenStorage.clear).toHaveBeenCalled();
    });

    it("falls back to cached user on network error", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockRejectedValue(new Error("Network error"));
      mockAsyncStorage["@ocrecipes_auth"] = JSON.stringify(fakeUser);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(fakeUser);
    });

    it("sets unauthenticated on network error with no cache", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });

  describe("login", () => {
    it("stores token, caches user, and sets authenticated state", async () => {
      mockTokenStorage.get.mockResolvedValue(null);
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ user: fakeUser, token: "new-token" }),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.login("testuser", "password123");
      });

      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/login", {
        username: "testuser",
        password: "password123",
      });
      expect(mockTokenStorage.set).toHaveBeenCalledWith("new-token");
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(fakeUser);
      expect(mockAsyncStorage["@ocrecipes_auth"]).toBe(
        JSON.stringify(fakeUser),
      );
    });
  });

  describe("register", () => {
    it("stores token, caches user, and sets authenticated state", async () => {
      mockTokenStorage.get.mockResolvedValue(null);
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ user: fakeUser, token: "reg-token" }),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.register("newuser", "password456");
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/auth/register",
        {
          username: "newuser",
          password: "password456",
        },
      );
      expect(mockTokenStorage.set).toHaveBeenCalledWith("reg-token");
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(fakeUser);
    });
  });

  describe("logout", () => {
    it("clears token, AsyncStorage, and resets state", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      mockApiRequest.mockResolvedValue({});

      await act(async () => {
        await result.current.logout();
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/auth/logout",
        {},
      );
      expect(mockTokenStorage.clear).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it("still clears local state even if server logout fails", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      mockApiRequest.mockRejectedValue(new Error("Server error"));

      await act(async () => {
        await result.current.logout();
      });

      expect(mockTokenStorage.clear).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe("updateUser", () => {
    it("calls API and updates state with response", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      const updatedUser = { ...fakeUser, username: "updatedname" };
      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve(updatedUser),
      });

      await act(async () => {
        await result.current.updateUser({ username: "updatedname" });
      });

      expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/auth/profile", {
        username: "updatedname",
      });
      expect(result.current.user).toEqual(updatedUser);
      expect(mockAsyncStorage["@ocrecipes_auth"]).toBe(
        JSON.stringify(updatedUser),
      );
    });

    it("does nothing when not authenticated", async () => {
      mockTokenStorage.get.mockResolvedValue(null);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.updateUser({ username: "nope" });
      });

      expect(mockApiRequest).not.toHaveBeenCalled();
    });
  });

  describe("login error handling", () => {
    it("propagates API errors to the caller", async () => {
      mockTokenStorage.get.mockResolvedValue(null);
      mockApiRequest.mockRejectedValue(new Error("Invalid credentials"));

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.login("bad", "creds");
        }),
      ).rejects.toThrow("Invalid credentials");

      expect(result.current.isAuthenticated).toBe(false);
      expect(mockTokenStorage.set).not.toHaveBeenCalled();
    });
  });

  describe("register error handling", () => {
    it("propagates API errors to the caller", async () => {
      mockTokenStorage.get.mockResolvedValue(null);
      mockApiRequest.mockRejectedValue(new Error("Username already exists"));

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.register("taken", "password");
        }),
      ).rejects.toThrow("Username already exists");

      expect(result.current.isAuthenticated).toBe(false);
      expect(mockTokenStorage.set).not.toHaveBeenCalled();
    });
  });
});
