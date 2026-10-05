import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import { storage } from "../../storage";
import { register } from "../auth-social";
import { generateToken } from "../../middleware/auth";
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
} from "../../lib/social-identity/verify";
import {
  exchangeAppleCode,
  revokeAppleToken,
} from "../../lib/social-identity/apple-tokens";
import { encryptToken } from "../../lib/social-identity/token-crypto";
import {
  createMockUser,
  createMockUserIdentity,
} from "../../__tests__/factories";

// Real requireAuth (NOT mocked): connect/disconnect must refuse a caller
// without a session, and bind the link nonce to the authenticated user.
vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    consumeNonce: vi.fn(),
    findIdentity: vi.fn(),
    listIdentities: vi.fn(),
    insertIdentity: vi.fn(),
    deleteIdentity: vi.fn(),
    getSignInMethods: vi.fn(),
    getPendingSignIn: vi.fn(),
    getUser: vi.fn(),
  },
}));
vi.mock("express-rate-limit");
vi.mock("../../lib/social-identity/verify", async (orig) => ({
  ...(await orig<typeof import("../../lib/social-identity/verify")>()),
  verifyGoogleIdToken: vi.fn(),
  verifyAppleIdToken: vi.fn(),
}));
vi.mock("../../lib/social-identity/apple-tokens", () => ({
  exchangeAppleCode: vi.fn(),
  revokeAppleToken: vi.fn(),
}));

const ENV_KEYS = [
  "GOOGLE_OAUTH_WEB_CLIENT_ID",
  "GOOGLE_OAUTH_APP_CLIENT_IDS",
  "APPLE_TEAM_ID",
  "APPLE_SIGN_IN_KEY_ID",
  "APPLE_SIGN_IN_PRIVATE_KEY",
  "APPLE_BUNDLE_ID",
  "IDENTITY_TOKEN_ENC_KEY",
];
let savedEnv: Record<string, string | undefined>;

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}

const gmailClaims = {
  provider: "google" as const,
  sub: "g-1",
  email: "me@gmail.com",
  emailVerified: true,
  hostedDomain: null,
  isPrivateRelay: false,
  nonce: null,
};

let auth: { Authorization: string };

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    GOOGLE_OAUTH_WEB_CLIENT_ID: "web",
    GOOGLE_OAUTH_APP_CLIENT_IDS: "ios",
    APPLE_TEAM_ID: "T",
    APPLE_SIGN_IN_KEY_ID: "K",
    APPLE_SIGN_IN_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----x",
    APPLE_BUNDLE_ID: "com.ocrecipes.app",
    IDENTITY_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  });
  auth = { Authorization: `Bearer ${generateToken("u1", 0, true)}` };
  vi.mocked(storage.getUser).mockResolvedValue(
    createMockUser({ id: "u1", tokenVersion: 0, emailVerified: true }),
  );
  vi.mocked(storage.consumeNonce).mockResolvedValue(true);
  vi.mocked(storage.findIdentity).mockResolvedValue(undefined);
  vi.mocked(storage.listIdentities).mockResolvedValue([]);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.clearAllMocks();
});

describe("POST /api/auth/identities", () => {
  const body = { provider: "google", idToken: "t", nonce: "n" };

  it("401 without a session", async () => {
    const res = await request(app()).post("/api/auth/identities").send(body);
    expect(res.status).toBe(401);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it("connects google, binding the nonce to the caller", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.getSignInMethods).mockResolvedValue({
      password: true,
      google: { email: "me@gmail.com" },
      apple: null,
    });
    const res = await request(app())
      .post("/api/auth/identities")
      .set(auth)
      .send(body);
    expect(res.status).toBe(200);
    expect(storage.consumeNonce).toHaveBeenCalledWith("n", "link", "u1");
    expect(storage.insertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        provider: "google",
        providerSubject: "g-1",
      }),
    );
    expect(res.body.signInMethods.google).toEqual({ email: "me@gmail.com" });
  });

  it("401 when the nonce is not the caller's", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.consumeNonce).mockResolvedValue(false);
    const res = await request(app())
      .post("/api/auth/identities")
      .set(auth)
      .send(body);
    expect(res.status).toBe(401);
    expect(storage.insertIdentity).not.toHaveBeenCalled();
  });

  it("409 IDENTITY_IN_USE when another account owns it", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({ userId: "other" }),
    );
    const res = await request(app())
      .post("/api/auth/identities")
      .set(auth)
      .send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IDENTITY_IN_USE");
    expect(storage.insertIdentity).not.toHaveBeenCalled();
  });

  it("409 PROVIDER_ALREADY_CONNECTED when this account already has google", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.listIdentities).mockResolvedValue([
      createMockUserIdentity({
        userId: "u1",
        provider: "google",
        providerSubject: "g-other",
      }),
    ]);
    const res = await request(app())
      .post("/api/auth/identities")
      .set(auth)
      .send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROVIDER_ALREADY_CONNECTED");
  });

  it("apple connect fails closed when the exchange fails", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
    });
    vi.mocked(exchangeAppleCode).mockRejectedValue(new Error("down"));
    const res = await request(app())
      .post("/api/auth/identities")
      .set(auth)
      .send({
        provider: "apple",
        idToken: "t",
        nonce: "n",
        authorizationCode: "c",
      });
    expect(res.status).toBe(502);
    expect(storage.insertIdentity).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/auth/identities/:provider", () => {
  it("401 without a session", async () => {
    const res = await request(app()).delete("/api/auth/identities/apple");
    expect(res.status).toBe(401);
    expect(storage.deleteIdentity).not.toHaveBeenCalled();
  });

  it("409 LAST_SIGN_IN_METHOD for the only method", async () => {
    vi.mocked(storage.getSignInMethods).mockResolvedValue({
      password: false,
      google: null,
      apple: { email: null, isPrivateRelay: true },
    });
    const res = await request(app())
      .delete("/api/auth/identities/apple")
      .set(auth);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LAST_SIGN_IN_METHOD");
    expect(storage.deleteIdentity).not.toHaveBeenCalled();
  });

  it("disconnects apple, revoking first; a revoke failure does not block", async () => {
    vi.mocked(storage.getSignInMethods).mockResolvedValue({
      password: true,
      google: null,
      apple: { email: null, isPrivateRelay: true },
    });
    vi.mocked(storage.listIdentities).mockResolvedValue([
      createMockUserIdentity({
        id: "i1",
        userId: "u1",
        provider: "apple",
        appleRefreshTokenEnc: encryptToken("r1"),
      }),
    ]);
    vi.mocked(revokeAppleToken).mockRejectedValue(new Error("apple down"));
    const res = await request(app())
      .delete("/api/auth/identities/apple")
      .set(auth);
    expect(res.status).toBe(200);
    expect(revokeAppleToken).toHaveBeenCalledWith("r1", expect.anything());
    expect(storage.deleteIdentity).toHaveBeenCalledWith("u1", "apple");
    const revokeOrder = vi.mocked(revokeAppleToken).mock.invocationCallOrder[0];
    const deleteOrder = vi.mocked(storage.deleteIdentity).mock
      .invocationCallOrder[0];
    expect(revokeOrder).toBeLessThan(deleteOrder);
  });

  it("404 when not connected", async () => {
    vi.mocked(storage.getSignInMethods).mockResolvedValue({
      password: true,
      google: null,
      apple: null,
    });
    const res = await request(app())
      .delete("/api/auth/identities/google")
      .set(auth);
    expect(res.status).toBe(404);
  });

  it("400 for an unknown provider", async () => {
    const res = await request(app())
      .delete("/api/auth/identities/facebook")
      .set(auth);
    expect(res.status).toBe(400);
  });
});
