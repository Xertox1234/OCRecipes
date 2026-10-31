import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { reauthenticate } from "../auth-social";
import { storage } from "../../storage";

const { mockLog, mockGetKey } = vi.hoisted(() => ({
  mockLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  mockGetKey: vi.fn(),
}));
vi.mock("../../lib/logger", async (orig) => ({
  ...(await orig<typeof import("../../lib/logger")>()),
  createServiceLogger: () => mockLog,
}));
vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  TokenVersionChangedError: class TokenVersionChangedErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: { consumeNonce: vi.fn(), findIdentity: vi.fn() },
}));
// Only the network is faked: the remote JWKS key fetch. The real verifyJwt /
// TokenVerificationError / verifyProviderToken mapping all run.
vi.mock("jose", async (orig) => ({
  ...(await orig<typeof import("jose")>()),
  createRemoteJWKSet: () => mockGetKey,
}));

const ENV_KEYS = ["GOOGLE_OAUTH_WEB_CLIENT_ID", "GOOGLE_OAUTH_APP_CLIENT_IDS"];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.GOOGLE_OAUTH_WEB_CLIENT_ID = "web";
  process.env.GOOGLE_OAUTH_APP_CLIENT_IDS = "ios";
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** A structurally valid compact JWS (RS256 header) — reaches the key fetch. */
function wellFormedToken(): string {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", kid: "k1" })}.${b64({ sub: "s" })}.c2lnbmF0dXJl`;
}

async function reauthWith(idToken: string) {
  return reauthenticate("user-1", null, {
    provider: "google",
    idToken,
    nonce: "n-1",
  });
}

function loggedCause(): unknown {
  expect(mockLog.warn).toHaveBeenCalledTimes(1);
  return (mockLog.warn.mock.calls[0][0] as { cause?: unknown }).cause;
}

describe("reauthenticate — provider verification failure (R45)", () => {
  it("logs a JWKS/provider outage with its underlying cause", async () => {
    const token = wellFormedToken();
    mockGetKey.mockRejectedValue(new TypeError("fetch failed: ECONNRESET"));

    const ok = await reauthWith(token);

    expect(ok).toBe(false);
    expect(mockGetKey).toHaveBeenCalled();
    expect(storage.consumeNonce).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
      expect.stringContaining("reauth"),
    );
    expect(loggedCause()).toContain("TypeError: fetch failed: ECONNRESET");
    // The provider token itself is never logged.
    expect(JSON.stringify(mockLog.warn.mock.calls)).not.toContain(token);
  });

  it("logs a bad token with a different cause than an outage (control)", async () => {
    const ok = await reauthWith("secret-not-a-jwt");

    expect(ok).toBe(false);
    expect(mockGetKey).not.toHaveBeenCalled();
    const cause = loggedCause();
    expect(cause).toContain("JWSInvalid");
    expect(cause).not.toContain("fetch failed");
    expect(JSON.stringify(mockLog.warn.mock.calls)).not.toContain(
      "secret-not-a-jwt",
    );
  });
});
