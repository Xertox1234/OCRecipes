import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import bcrypt from "bcrypt";

import { storage } from "../../storage";
import { generateToken } from "../../middleware/auth";
import { register } from "../auth";
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
} from "../../lib/social-identity/verify";
import { revokeAppleToken } from "../../lib/social-identity/apple-tokens";
import { encryptToken } from "../../lib/social-identity/token-crypto";
import {
  createMockUser,
  createMockUserIdentity,
} from "../../__tests__/factories";

// REAL requireAuth: deletion is the most destructive authenticated action, so
// the provider re-auth branch is exercised end to end through the real
// middleware. Only storage, limiters, email, image cleanup and the provider
// SDK edges are mocked.
vi.mock("../../storage", () => ({
  ReservedUsernameError: class extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUser: vi.fn(),
    getUserForAuth: vi.fn(),
    findIdentity: vi.fn(),
    listIdentities: vi.fn(),
    consumeNonce: vi.fn(),
    deleteUser: vi.fn(),
    collectUserImageUrls: vi.fn().mockResolvedValue([]),
    filterUnreferencedImageUrls: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("express-rate-limit");
vi.mock("../../services/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendSignupAttemptNotice: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetCode: vi.fn().mockResolvedValue(undefined),
  sendPasswordChangedNotice: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/image-store", () => ({
  saveAvatar: vi.fn(),
  deleteImage: vi.fn().mockResolvedValue(undefined),
}));
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
let auth: { Authorization: string };

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
const appleClaims = { ...gmailClaims, provider: "apple" as const, sub: "a-1" };

function appleIdentity() {
  return createMockUserIdentity({
    userId: "u1",
    provider: "apple",
    providerSubject: "a-1",
    appleRefreshTokenEnc: encryptToken("r1"),
  });
}

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
  const user = createMockUser({ id: "u1", tokenVersion: 0, password: null });
  vi.mocked(storage.getUser).mockResolvedValue(user);
  vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
  vi.mocked(storage.consumeNonce).mockResolvedValue(true);
  vi.mocked(storage.listIdentities).mockResolvedValue([]);
  vi.mocked(storage.deleteUser).mockResolvedValue(true);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.clearAllMocks();
});

describe("DELETE /api/auth/account — provider re-auth", () => {
  it("accepts a fresh Apple token for a linked identity and revokes before deleting", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue(appleClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue(appleIdentity());
    vi.mocked(storage.listIdentities).mockResolvedValue([appleIdentity()]);
    const order: string[] = [];
    vi.mocked(revokeAppleToken).mockImplementation(async () => {
      order.push("revoke");
    });
    vi.mocked(storage.deleteUser).mockImplementation(async () => {
      order.push("delete");
      return true;
    });
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ provider: "apple", idToken: "t", nonce: "n" });
    expect(res.status).toBe(200);
    expect(storage.consumeNonce).toHaveBeenCalledWith("n", "reauth", "u1");
    expect(revokeAppleToken).toHaveBeenCalledWith("r1", expect.anything());
    expect(order).toEqual(["revoke", "delete"]);
  });

  it("still deletes when Apple revoke fails", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue(appleClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue(appleIdentity());
    vi.mocked(storage.listIdentities).mockResolvedValue([appleIdentity()]);
    vi.mocked(revokeAppleToken).mockRejectedValue(new Error("down"));
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ provider: "apple", idToken: "t", nonce: "n" });
    expect(res.status).toBe(200);
    expect(storage.deleteUser).toHaveBeenCalledWith("u1");
  });

  it("rejects a provider token linked to a different account", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({ userId: "someone-else" }),
    );
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ provider: "google", idToken: "t", nonce: "n" });
    expect(res.status).toBe(401);
    expect(storage.deleteUser).not.toHaveBeenCalled();
  });

  it("rejects a reauth nonce that is not the caller's", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({ userId: "u1" }),
    );
    vi.mocked(storage.consumeNonce).mockResolvedValue(false);
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ provider: "google", idToken: "t", nonce: "n" });
    expect(res.status).toBe(401);
    expect(storage.deleteUser).not.toHaveBeenCalled();
  });

  it("rejects a provider token that does not verify", async () => {
    const { TokenVerificationError } = await import(
      "../../lib/social-identity/verify"
    );
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(
      new TokenVerificationError("bad"),
    );
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ provider: "google", idToken: "t", nonce: "n" });
    expect(res.status).toBe(401);
    expect(storage.deleteUser).not.toHaveBeenCalled();
  });

  it("password deletion also revokes Apple tokens", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({
        id: "u1",
        password: await bcrypt.hash("pw-123456", 4),
      }),
    );
    vi.mocked(storage.listIdentities).mockResolvedValue([appleIdentity()]);
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ password: "pw-123456" });
    expect(res.status).toBe(200);
    expect(revokeAppleToken).toHaveBeenCalled();
  });

  it("401 without a session", async () => {
    const res = await request(app())
      .delete("/api/auth/account")
      .send({ provider: "google", idToken: "t", nonce: "n" });
    expect(res.status).toBe(401);
    expect(storage.deleteUser).not.toHaveBeenCalled();
  });
});
