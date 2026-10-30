import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { reauthenticate } from "../auth-social";
import { storage } from "../../storage";
import { verifyGoogleIdToken } from "../../lib/social-identity/verify";

const { mockLog } = vi.hoisted(() => ({
  mockLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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
vi.mock("../../lib/social-identity/verify", async (orig) => ({
  ...(await orig<typeof import("../../lib/social-identity/verify")>()),
  verifyGoogleIdToken: vi.fn(),
  verifyAppleIdToken: vi.fn(),
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

describe("reauthenticate — provider verification failure (R45)", () => {
  it("still answers false, but logs a warn naming the provider", async () => {
    const outage = new Error("JWKS fetch failed: ECONNRESET");
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(outage);

    const ok = await reauthenticate("user-1", null, {
      provider: "google",
      idToken: "secret-id-token",
      nonce: "n-1",
    });

    expect(ok).toBe(false);
    expect(storage.consumeNonce).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google", err: outage }),
      expect.stringContaining("reauth"),
    );
    // The provider token itself is never logged.
    expect(JSON.stringify(mockLog.warn.mock.calls)).not.toContain(
      "secret-id-token",
    );
  });
});
