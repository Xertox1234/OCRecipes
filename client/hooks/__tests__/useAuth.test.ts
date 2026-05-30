// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuth } from "../useAuth";

// Create mock storage and functions that survive vi.mock hoisting
const {
  mockAsyncStorage,
  mockTokenStorage,
  mockApiRequest,
  mockGetApiUrl,
  mockFetch,
  mockQueryClient,
  mockNotifySessionExpired,
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
    mockQueryClient: { clear: vi.fn() },
    mockNotifySessionExpired: vi.fn(),
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
  queryClient: mockQueryClient,
  notifySessionExpired: () => mockNotifySessionExpired(),
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

    it("fires the session-expiry emitter on a 401 from /me (so foreground-resume expiry is not silent)", async () => {
      // The proactive /me check uses raw fetch (not the interceptor). Routing a
      // 401 through the same emitter lets the SessionExpiryBridge show the
      // 'session expired' toast on foreground resume; its isAuthenticated gate
      // keeps a cold-launch expired token silent.
      mockTokenStorage.get.mockResolvedValue("expired-token");
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockNotifySessionExpired).toHaveBeenCalled();
      // Still clears locally too (covers cold-launch, where the bridge ignores).
      expect(mockTokenStorage.clear).toHaveBeenCalled();
    });

    it("does NOT fire the session-expiry emitter on a non-401 /me failure", async () => {
      // A 500 from /me is not session death — don't trigger the logout path.
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockNotifySessionExpired).not.toHaveBeenCalled();
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

    it("handles a corrupt cached blob WITHOUT a silent logout (token preserved, poison key dropped)", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockRejectedValue(new Error("Network error"));
      // Unparseable JSON — today this throws out of the network-error catch and
      // silently logs the user out.
      mockAsyncStorage["@ocrecipes_auth"] = "{ corrupt-not-json";

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // The session token MUST survive — the corrupt cache is the problem, not
      // the token. This is what makes it not a "logout": the next foreground
      // re-check / relaunch re-validates and restores the session.
      expect(mockTokenStorage.clear).not.toHaveBeenCalled();
      // The poison blob is removed so it stops re-throwing on later reads.
      expect(mockAsyncStorage["@ocrecipes_auth"]).toBeUndefined();
      // Offline + no usable cache → unauthenticated, but recoverable.
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });

  describe("foreground re-check (AppState)", () => {
    let appStateHandler: ((state: AppStateStatus) => void) | undefined;

    beforeEach(() => {
      appStateHandler = undefined;
      // Capture the handler the hook registers so tests can drive lifecycle
      // transitions. (The shared RN mock's addEventListener does not store it.)
      vi.mocked(AppState.addEventListener).mockImplementation(
        (_event, listener) => {
          appStateHandler = listener;
          return { remove: vi.fn() };
        },
      );
    });

    afterEach(() => {
      // Restore default behavior so the captured-handler impl does not leak into
      // other describe blocks (clearAllMocks resets call history, not impls).
      vi.mocked(AppState.addEventListener).mockImplementation(() => ({
        remove: vi.fn(),
      }));
    });

    async function mountAuthenticated() {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });
      const view = renderHook(() => useAuth());
      await waitFor(() => expect(view.result.current.isLoading).toBe(false));
      expect(mockFetch).toHaveBeenCalledTimes(1); // mount check
      return view;
    }

    it("re-validates auth when the app returns to the foreground (background → active)", async () => {
      await mountAuthenticated();

      await act(async () => {
        appStateHandler?.("background");
        appStateHandler?.("active");
      });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    });

    it("re-checks across the iOS background → inactive → active resume sequence", async () => {
      await mountAuthenticated();

      await act(async () => {
        appStateHandler?.("background");
        appStateHandler?.("inactive");
        appStateHandler?.("active");
      });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    });

    it("does NOT re-check on the spurious mount-time 'active' (no prior background)", async () => {
      await mountAuthenticated();

      await act(async () => {
        appStateHandler?.("active");
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT re-check on iOS inactive → active churn (control center, no real background)", async () => {
      await mountAuthenticated();

      await act(async () => {
        appStateHandler?.("inactive");
        appStateHandler?.("active");
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("collapses rapid foreground cycles while a re-check is already in flight", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      let resolveSecond: (value: unknown) => void = () => {};
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fakeUser),
        }) // mount
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            }), // first foreground re-check hangs
        );

      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        appStateHandler?.("background");
        appStateHandler?.("active"); // fires re-check #1 (hangs)
        appStateHandler?.("background");
        appStateHandler?.("active"); // suppressed — #1 still in flight
      });

      // Only the first foreground re-check fired; the second was collapsed.
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Resolve the hung fetch so the test leaves no pending work.
      await act(async () => {
        resolveSecond({ ok: true, json: () => Promise.resolve(fakeUser) });
      });
    });

    it("removes the AppState listener on unmount", async () => {
      const remove = vi.fn();
      vi.mocked(AppState.addEventListener).mockImplementation(
        (_e, listener) => {
          appStateHandler = listener;
          return { remove };
        },
      );
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });

      const { result, unmount } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      unmount();
      expect(remove).toHaveBeenCalledTimes(1);
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
        await result.current.register("newuser", "password456", true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/auth/register",
        {
          username: "newuser",
          password: "password456",
          ageConfirmed: true,
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
      // Clears the TanStack Query cache so a subsequent sign-in can't read the
      // previous session's stale data (cross-session privacy).
      expect(mockQueryClient.clear).toHaveBeenCalled();
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

    it("still clears auth state if queryClient.clear() throws during logout", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });

      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

      mockApiRequest.mockResolvedValue({});
      mockQueryClient.clear.mockImplementationOnce(() => {
        throw new Error("clear boom");
      });

      await act(async () => {
        await result.current.logout();
      });

      // The guarded clear must not skip the logout setState.
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(mockTokenStorage.clear).toHaveBeenCalled();
    });
  });

  describe("deleteAccount", () => {
    it("clears the query cache so the next user can't read the deleted account's data", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });

      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

      mockApiRequest.mockResolvedValue({});

      await act(async () => {
        await result.current.deleteAccount("correct-password");
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/auth/account",
        {
          password: "correct-password",
        },
      );
      // Permanent deletion → the previous user's cached data must not survive
      // for whoever signs in next on this device.
      expect(mockQueryClient.clear).toHaveBeenCalled();
      expect(mockTokenStorage.clear).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe("expireSession", () => {
    it("clears local auth state WITHOUT calling the server logout endpoint", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });

      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

      mockApiRequest.mockClear();

      await act(async () => {
        await result.current.expireSession();
      });

      // Local teardown happened...
      expect(mockTokenStorage.clear).toHaveBeenCalled();
      expect(mockAsyncStorage["@ocrecipes_auth"]).toBeUndefined();
      expect(mockQueryClient.clear).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      // ...but NO server round-trip. The token is already dead — POSTing logout
      // with it would 401 and re-trigger the interceptor (an expiry loop).
      expect(mockApiRequest).not.toHaveBeenCalled();
    });

    it("still clears auth state (and never throws) if queryClient.clear() throws", async () => {
      mockTokenStorage.get.mockResolvedValue("valid-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeUser),
      });

      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

      mockQueryClient.clear.mockImplementationOnce(() => {
        throw new Error("clear boom");
      });

      // Runs from the SessionExpiryBridge event handler → must never throw, and
      // the logout setState must still run even if cache-clear blows up.
      await act(async () => {
        await expect(result.current.expireSession()).resolves.toBeUndefined();
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(mockTokenStorage.clear).toHaveBeenCalled();
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
          await result.current.register("taken", "password", true);
        }),
      ).rejects.toThrow("Username already exists");

      expect(result.current.isAuthenticated).toBe(false);
      expect(mockTokenStorage.set).not.toHaveBeenCalled();
    });
  });
});
