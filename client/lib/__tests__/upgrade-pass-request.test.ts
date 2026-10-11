// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRequest, subscribeToSessionExpiry } from "../query-client";
import { upgradeRequest } from "../upgrade-pass-request";
import { ApiError } from "../api-error";

const { mockTokenStorage } = vi.hoisted(() => ({
  mockTokenStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));
vi.mock("../token-storage", () => ({ tokenStorage: mockTokenStorage }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(json(200, {}));
  vi.stubGlobal("fetch", fetchMock);
  // A real session is stored on this phone: the helper must never send it.
  mockTokenStorage.get.mockResolvedValue("stored-jwt");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const sentHeaders = () =>
  (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
    string,
    string
  >;

describe("upgradeRequest", () => {
  it("POSTs with Authorization: UpgradePass <pass>, never the stored Bearer token", async () => {
    await upgradeRequest("/api/auth/upgrade/password", "the-pass", {
      newPassword: "x",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/auth/upgrade/password");
    expect((init as RequestInit).method).toBe("POST");
    expect(sentHeaders().Authorization).toBe("UpgradePass the-pass");
    expect(JSON.stringify(sentHeaders())).not.toContain("stored-jwt");
    expect(mockTokenStorage.get).not.toHaveBeenCalled();
  });

  it("sends a JSON body even when the route takes none", async () => {
    await upgradeRequest("/api/auth/upgrade/totp/setup", "the-pass");
    expect(sentHeaders()["Content-Type"]).toBe("application/json");
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe("{}");
  });

  it("a 401 throws ApiError(UPGRADE_PASS_EXPIRED) and does NOT fire the session-expired toast", async () => {
    fetchMock.mockResolvedValue(
      json(401, {
        error: "This sign-in expired. Please sign in again.",
        code: "UPGRADE_PASS_EXPIRED",
      }),
    );
    const listener = vi.fn();
    const unsub = subscribeToSessionExpiry(listener);
    const err = await upgradeRequest(
      "/api/auth/upgrade/password",
      "the-pass",
      {},
    ).catch((e: unknown) => e);
    unsub();
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("UPGRADE_PASS_EXPIRED");
    expect(listener).not.toHaveBeenCalled();
  });

  it("positive control: the same harness DOES see the toast for a Bearer request's revoked token", async () => {
    fetchMock.mockResolvedValue(
      json(401, { error: "Token has been revoked", code: "TOKEN_REVOKED" }),
    );
    const listener = vi.fn();
    const unsub = subscribeToSessionExpiry(listener);
    await apiRequest("GET", "/api/auth/me").catch(() => undefined);
    unsub();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
