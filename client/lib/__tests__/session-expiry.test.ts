// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Real module under test. `vi.mock("../token-storage")` below is hoisted above
// this import, so query-client sees the mocked token-storage. The `globalThis.fetch`
// override is resolved at call time (query-client calls `fetch` inside its fns,
// not at import), so its textual position after this import is fine.
import {
  apiRequest,
  getQueryFn,
  subscribeToSessionExpiry,
} from "../query-client";

// Mock token-storage so we control whether a Bearer token is attached. The real
// `query-client` module imports the same singleton, so both paths see the mock.
const { mockTokenStorage, mockFetch } = vi.hoisted(() => ({
  mockTokenStorage: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    invalidateCache: vi.fn(),
  },
  mockFetch: vi.fn(),
}));

vi.mock("../token-storage", () => ({ tokenStorage: mockTokenStorage }));

const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch as unknown as typeof fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function mockResponse(status: number, body: unknown = {}) {
  // `clone()` is modeled because the interceptor reads the 401 body via
  // res.clone().text() (so the caller's own res.text()/.json() stays intact).
  const make = (): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      text: () =>
        Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
      json: () => Promise.resolve(body),
      clone: () => make(),
    }) as unknown as Response;
  return make();
}

// getQueryFn's returned fn only destructures `queryKey` off its context.
function queryCtx(queryKey: unknown[]) {
  return { queryKey } as unknown as Parameters<
    ReturnType<typeof getQueryFn>
  >[0];
}

describe("session-expiry interceptor (real query-client module)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("apiRequest", () => {
    it("fires session-expiry on a 401 when a Bearer token was attached", async () => {
      mockTokenStorage.get.mockResolvedValue("live-token");
      mockFetch.mockResolvedValue(
        mockResponse(401, {
          error: "Token has been revoked",
          code: "TOKEN_REVOKED",
        }),
      );
      const listener = vi.fn();
      const unsub = subscribeToSessionExpiry(listener);

      await expect(apiRequest("GET", "/api/protected")).rejects.toThrow(
        /^401:/,
      );

      unsub();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire on a 401 when NO token was attached (e.g. wrong-password login)", async () => {
      mockTokenStorage.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue(
        mockResponse(401, { error: "Invalid credentials" }),
      );
      const listener = vi.fn();
      const unsub = subscribeToSessionExpiry(listener);

      await expect(
        apiRequest("POST", "/api/auth/login", { username: "x", password: "y" }),
      ).rejects.toThrow(/^401:/);

      unsub();
      expect(listener).not.toHaveBeenCalled();
    });

    it("does NOT fire on a non-401 error even with a token attached", async () => {
      mockTokenStorage.get.mockResolvedValue("live-token");
      mockFetch.mockResolvedValue(
        mockResponse(500, { error: "Internal Server Error" }),
      );
      const listener = vi.fn();
      const unsub = subscribeToSessionExpiry(listener);

      await expect(apiRequest("GET", "/api/protected")).rejects.toThrow(
        /^500:/,
      );

      unsub();
      expect(listener).not.toHaveBeenCalled();
    });

    it("does NOT fire on a token-bearing 401 whose code is NOT a session code (e.g. wrong-password UNAUTHORIZED)", async () => {
      // A route handler behind requireAuth (e.g. DELETE /api/auth/account on a
      // wrong confirmation password) returns 401 + UNAUTHORIZED while the user
      // is still authenticated. This is NOT session death — must not log out.
      mockTokenStorage.get.mockResolvedValue("live-token");
      mockFetch.mockResolvedValue(
        mockResponse(401, {
          error: "Invalid credentials",
          code: "UNAUTHORIZED",
        }),
      );
      const listener = vi.fn();
      const unsub = subscribeToSessionExpiry(listener);

      await expect(
        apiRequest("DELETE", "/api/auth/account", { password: "wrong" }),
      ).rejects.toThrow(/^401:/);

      unsub();
      expect(listener).not.toHaveBeenCalled();
    });

    it("does NOT fire on a token-bearing 401 with no machine-readable code", async () => {
      // Only the auth middleware (the sole source of session death) tags a 401
      // with a TOKEN_* code; a bare/uncoded 401 is not a token rejection.
      mockTokenStorage.get.mockResolvedValue("live-token");
      mockFetch.mockResolvedValue(mockResponse(401, { error: "nope" }));
      const listener = vi.fn();
      const unsub = subscribeToSessionExpiry(listener);

      await expect(apiRequest("GET", "/api/protected")).rejects.toThrow(
        /^401:/,
      );

      unsub();
      expect(listener).not.toHaveBeenCalled();
    });

    it("fires for each session-token code (TOKEN_EXPIRED / TOKEN_INVALID / TOKEN_REVOKED)", async () => {
      mockTokenStorage.get.mockResolvedValue("live-token");
      for (const code of ["TOKEN_EXPIRED", "TOKEN_INVALID", "TOKEN_REVOKED"]) {
        mockFetch.mockResolvedValue(mockResponse(401, { code }));
        const listener = vi.fn();
        const unsub = subscribeToSessionExpiry(listener);
        await expect(apiRequest("GET", "/api/protected")).rejects.toThrow(
          /^401:/,
        );
        unsub();
        expect(listener, `should fire for ${code}`).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("getQueryFn", () => {
    it("fires session-expiry on a 401 with a token even in returnNull mode (before the short-circuit)", async () => {
      mockTokenStorage.get.mockResolvedValue("live-token");
      mockFetch.mockResolvedValue(mockResponse(401, { code: "TOKEN_INVALID" }));
      const listener = vi.fn();
      const unsub = subscribeToSessionExpiry(listener);

      const queryFn = getQueryFn({ on401: "returnNull" });
      const result = await queryFn(queryCtx(["api", "me"]));

      unsub();
      expect(result).toBeNull();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("fires session-expiry on a 401 with a token in throw mode", async () => {
      mockTokenStorage.get.mockResolvedValue("live-token");
      mockFetch.mockResolvedValue(
        mockResponse(401, { error: "Token invalid", code: "TOKEN_INVALID" }),
      );
      const listener = vi.fn();
      const unsub = subscribeToSessionExpiry(listener);

      const queryFn = getQueryFn({ on401: "throw" });
      await expect(queryFn(queryCtx(["api", "protected"]))).rejects.toThrow(
        /^401:/,
      );

      unsub();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire on a 401 with NO token attached", async () => {
      mockTokenStorage.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockResponse(401, null));
      const listener = vi.fn();
      const unsub = subscribeToSessionExpiry(listener);

      const queryFn = getQueryFn({ on401: "returnNull" });
      await queryFn(queryCtx(["api", "me"]));

      unsub();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("subscribeToSessionExpiry", () => {
    it("stops notifying after unsubscribe and is idempotent", async () => {
      mockTokenStorage.get.mockResolvedValue("live-token");
      mockFetch.mockResolvedValue(mockResponse(401, { code: "TOKEN_REVOKED" }));
      const listener = vi.fn();
      const unsub = subscribeToSessionExpiry(listener);
      unsub();
      expect(() => unsub()).not.toThrow();

      await expect(apiRequest("GET", "/api/protected")).rejects.toThrow(
        /^401:/,
      );
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
