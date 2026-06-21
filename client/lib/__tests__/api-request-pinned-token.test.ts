import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock token storage so we can assert apiRequest does NOT read it when an
// explicit bearer is pinned (the offline-drain microtask-TOCTOU guard) and DOES
// read it when no override is passed (backward compatibility for ~50 callers).
vi.mock("@/lib/token-storage", () => ({
  tokenStorage: { get: vi.fn() },
}));

describe("apiRequest pinned bearer override", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function authHeaderFromLastFetch(): string | undefined {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    return (init?.headers as Record<string, string> | undefined)?.[
      "Authorization"
    ];
  }

  it("uses the pinned bearer and does NOT read tokenStorage at dispatch time", async () => {
    const { apiRequest } = await import("@/lib/query-client");
    const { tokenStorage } = await import("@/lib/token-storage");
    // Storage would resolve to a DIFFERENT token — the value a logout+relogin
    // mutated it to in the microtask gap. The pinned token must win, and storage
    // must not even be consulted (no dispatch-time re-read).
    vi.mocked(tokenStorage.get).mockResolvedValue("token-B-mutated");

    await apiRequest(
      "POST",
      "/api/scanned-items",
      { x: 1 },
      undefined,
      "token-A-pinned",
    );

    expect(authHeaderFromLastFetch()).toBe("Bearer token-A-pinned");
    expect(tokenStorage.get).not.toHaveBeenCalled();
  });

  it("pins 'no auth' when the override is explicitly null (no Authorization header, no storage read)", async () => {
    const { apiRequest } = await import("@/lib/query-client");
    const { tokenStorage } = await import("@/lib/token-storage");
    vi.mocked(tokenStorage.get).mockResolvedValue("token-from-storage");

    await apiRequest("GET", "/api/health", undefined, undefined, null);

    expect(authHeaderFromLastFetch()).toBeUndefined();
    expect(tokenStorage.get).not.toHaveBeenCalled();
  });

  it("falls back to tokenStorage when no override is passed (backward compatible for existing callers)", async () => {
    const { apiRequest } = await import("@/lib/query-client");
    const { tokenStorage } = await import("@/lib/token-storage");
    vi.mocked(tokenStorage.get).mockResolvedValue("token-from-storage");

    await apiRequest("GET", "/api/scanned-items");

    expect(tokenStorage.get).toHaveBeenCalledOnce();
    expect(authHeaderFromLastFetch()).toBe("Bearer token-from-storage");
  });

  it("still fires the session-expiry signal on a 401 when the bearer was pinned (a pinned token counts as attached)", async () => {
    const { apiRequest, subscribeToSessionExpiry } = await import(
      "@/lib/query-client"
    );
    // A token-bearing 401 carrying a session-death code must trigger logout
    // regardless of HOW the bearer was supplied — the pinned path must pass
    // `tokenAttached: true` to notifyIfSessionExpired just like the storage path.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "expired", code: "TOKEN_EXPIRED" }),
        {
          status: 401,
        },
      ),
    );
    const expiryListener = vi.fn();
    const unsubscribe = subscribeToSessionExpiry(expiryListener);

    await expect(
      apiRequest(
        "POST",
        "/api/scanned-items",
        { x: 1 },
        undefined,
        "token-A-pinned",
      ),
    ).rejects.toThrow();

    expect(expiryListener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
