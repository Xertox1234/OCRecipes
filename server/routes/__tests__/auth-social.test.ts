import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { storage } from "../../storage";
import { register } from "../auth-social";
import { crudRateLimit } from "../_rate-limiters";
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
  TokenVerificationError,
} from "../../lib/social-identity/verify";
import {
  exchangeAppleCode,
  revokeAppleToken,
} from "../../lib/social-identity/apple-tokens";
import { encryptToken } from "../../lib/social-identity/token-crypto";
import { emailVerificationEnabled } from "../../lib/email-config";
import {
  createMockUser,
  createMockUserIdentity,
  createMockPendingSocialSignIn,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: (u: string) => u.toLowerCase() === "demo",
  storage: {
    issueNonce: vi.fn(),
    consumeNonce: vi.fn(),
    findIdentity: vi.fn(),
    appleGrantInUse: vi.fn(),
    listIdentities: vi.fn(),
    insertIdentity: vi.fn(),
    setAppleRefreshToken: vi.fn(),
    touchIdentity: vi.fn(),
    createPendingSignIn: vi.fn(),
    sweepExpiredPendingSignIns: vi.fn(),
    getPendingSignIn: vi.fn(),
    reservePendingLinkAttempt: vi.fn(),
    // The per-account cap has room (its own file covers the 429).
    reserveLinkPasswordGuess: vi.fn().mockResolvedValue(true),
    refundLinkPasswordGuess: vi.fn().mockResolvedValue(undefined),
    completeLinkFromTicket: vi.fn(),
    createMfaChallenge: vi.fn(),
    createUpgradePass: vi.fn(),
    createUserWithIdentity: vi.fn(),
    getUserByEmailForAuth: vi.fn(),
    getUserForAuth: vi.fn(),
    getUserByUsername: vi.fn(),
    getUser: vi.fn(),
  },
}));
vi.mock("express-rate-limit");
vi.mock("../../lib/email-config", () => ({
  emailVerificationEnabled: vi.fn(),
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
  vi.mocked(emailVerificationEnabled).mockReturnValue(true);
  vi.mocked(storage.consumeNonce).mockResolvedValue(true);
  vi.mocked(storage.listIdentities).mockResolvedValue([]);
  vi.mocked(storage.findIdentity).mockResolvedValue(undefined);
  vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(undefined);
  vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
  vi.mocked(storage.createPendingSignIn).mockResolvedValue("ticket-1");
  vi.mocked(storage.sweepExpiredPendingSignIns).mockResolvedValue([]);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("GET /api/auth/social/config", () => {
  it("reports configured providers", async () => {
    const res = await request(app()).get("/api/auth/social/config");
    expect(res.body).toEqual({ google: true, apple: true });
  });
  // Auth audit 2026-10-10 L18: the only route in this file without a limiter.
  // express-rate-limit is a pass-through here, so assert the wiring itself.
  it("is mounted behind crudRateLimit", () => {
    const a = express();
    register(a);
    const layer = (
      a.router.stack as {
        route?: { path: string; stack: { handle: unknown }[] };
      }[]
    ).find((l) => l.route?.path === "/api/auth/social/config");
    expect(layer?.route?.stack.map((s) => s.handle)).toContain(crudRateLimit);
  });
  it("reports apple false without the encryption key", async () => {
    delete process.env.IDENTITY_TOKEN_ENC_KEY;
    const res = await request(app()).get("/api/auth/social/config");
    expect(res.body).toEqual({ google: true, apple: false });
  });
});

describe("POST /api/auth/social", () => {
  const body = { provider: "google", idToken: "t", nonce: "n" };

  it("401 when the token does not verify", async () => {
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(
      new TokenVerificationError("bad"),
    );
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_PROVIDER_TOKEN");
  });

  it("401 when the nonce was already used", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.consumeNonce).mockResolvedValue(false);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(401);
    expect(storage.consumeNonce).toHaveBeenCalledWith("n", "sign_in", null);
  });

  it("404 PROVIDER_NOT_CONFIGURED when the provider is off", async () => {
    delete process.env.GOOGLE_OAUTH_WEB_CLIENT_ID;
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("signs in an already-linked identity with a working session token", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({
        id: "i1",
        userId: "u1",
        provider: "google",
      }),
    );
    const user = createMockUser({
      id: "u1",
      emailVerified: true,
      tokenVersion: 0,
    });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("signed_in");
    // REAL requireAuth accepts the token (proves it is our normal session JWT)
    const authed = express();
    authed.use(express.json());
    const { requireAuth } = await import("../../middleware/auth");
    authed.get("/probe", requireAuth, (_req, r) => {
      r.json({ ok: true });
    });
    const probe = await request(authed)
      .get("/probe")
      .set("Authorization", `Bearer ${res.body.token}`);
    expect(probe.status).toBe(200);
  });

  it("choose_username when no account has the email", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body).toMatchObject({
      status: "choose_username",
      ticket: "ticket-1",
      suggestedUsername: expect.any(String),
    });
    expect(storage.createPendingSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "sign_up", email: "me@gmail.com" }),
    );
  });

  it("refuses a sign-up from an unverified provider email, creating nothing", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({
      ...gmailClaims,
      email: "me@example.org",
      emailVerified: false,
    });
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PROVIDER_EMAIL_REQUIRED");
    expect(storage.createPendingSignIn).not.toHaveBeenCalled();
  });

  it("an unverified provider email never reaches an existing account (no ticket, no lookup)", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({
      ...gmailClaims,
      email: "victim@example.org",
      emailVerified: false,
    });
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(
      createMockUser({
        id: "victim",
        email: "victim@example.org",
        emailVerified: true,
      }),
    );
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PROVIDER_EMAIL_REQUIRED");
    expect(res.body.status).toBeUndefined();
    expect(storage.getUserByEmailForAuth).not.toHaveBeenCalled();
    expect(storage.createPendingSignIn).not.toHaveBeenCalled();
  });

  it("the sign-up ticket carries the provider's email_verified claim", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    await request(app()).post("/api/auth/social").send(body);
    expect(storage.createPendingSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "sign_up", emailVerified: true }),
    );
  });

  it("400 PROVIDER_EMAIL_REQUIRED when unlinked and no email", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({
      ...gmailClaims,
      email: null,
    });
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PROVIDER_EMAIL_REQUIRED");
  });

  it("auto-links a gmail address onto a verified password-less account", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    const user = createMockUser({
      id: "u1",
      email: "me@gmail.com",
      emailVerified: true,
      password: null,
    });
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body.status).toBe("signed_in");
    expect(storage.insertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        provider: "google",
        providerSubject: "g-1",
      }),
    );
  });

  it("link_required (never auto-link) onto a verified account that has a password", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(
      createMockUser({ id: "u1", email: "me@gmail.com", emailVerified: true }),
    );
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body).toMatchObject({
      status: "link_required",
      methods: ["password"],
    });
    expect(storage.insertIdentity).not.toHaveBeenCalled();
  });

  it("link_required for a non-gmail Google address, without inserting", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({
      ...gmailClaims,
      email: "me@yahoo.com",
    });
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(
      createMockUser({ id: "u1", email: "me@yahoo.com", emailVerified: true }),
    );
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body).toMatchObject({
      status: "link_required",
      methods: ["password"],
    });
    expect(storage.insertIdentity).not.toHaveBeenCalled();
  });

  it("an address present only as someone's pendingEmail is treated as unregistered", async () => {
    // getUserByEmailForAuth matches users.email only, so a pendingEmail holder is invisible here.
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(undefined);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body.status).toBe("choose_username");
  });

  it("first Apple sign-in fails when the code exchange fails, creating nothing", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      email: "me@icloud.com",
    });
    vi.mocked(exchangeAppleCode).mockRejectedValue(new Error("apple down"));
    const res = await request(app()).post("/api/auth/social").send({
      provider: "apple",
      idToken: "t",
      nonce: "n",
      authorizationCode: "c",
    });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("PROVIDER_EXCHANGE_FAILED");
    expect(storage.createPendingSignIn).not.toHaveBeenCalled();
  });

  // Auth audit 2026-10-10 L17: an Apple refresh token exchanged during a
  // sign-in that then fails before storing it is revoked (App Store 5.1.1(v)),
  // unless that Apple ID is linked — revoking ends the app's whole grant.
  describe("an exchanged Apple token that never gets stored", () => {
    const appleClaims = {
      ...gmailClaims,
      provider: "apple" as const,
      email: "me@icloud.com",
    };
    const send = () =>
      request(app()).post("/api/auth/social").send({
        provider: "apple",
        idToken: "t",
        nonce: "n",
        authorizationCode: "c",
      });
    beforeEach(() => {
      vi.mocked(storage.appleGrantInUse).mockResolvedValue(false);
      vi.mocked(verifyAppleIdToken).mockResolvedValue(appleClaims);
      vi.mocked(exchangeAppleCode).mockResolvedValue("orphan-refresh");
      vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(
        createMockUser({
          id: "u1",
          email: "me@icloud.com",
          emailVerified: true,
          password: null,
        }),
      );
    });

    it("is revoked when the request then fails", async () => {
      vi.mocked(storage.insertIdentity).mockRejectedValue(new Error("db down"));
      const res = await send();
      expect(res.status).toBe(500);
      await vi.waitFor(() =>
        expect(revokeAppleToken).toHaveBeenCalledWith(
          "orphan-refresh",
          expect.anything(),
        ),
      );
      expect(storage.appleGrantInUse).toHaveBeenCalledWith(appleClaims.sub);
    });

    it("is NOT revoked while that Apple grant is in use (linked, or on a live ticket)", async () => {
      vi.mocked(storage.insertIdentity).mockRejectedValue(
        Object.assign(new Error("dup"), { code: "23505" }),
      );
      vi.mocked(storage.appleGrantInUse).mockResolvedValue(true);
      const res = await send();
      expect(res.status).toBe(409);
      await new Promise((r) => setTimeout(r, 20));
      expect(revokeAppleToken).not.toHaveBeenCalled();
    });

    it("is NOT revoked once stored (success)", async () => {
      vi.mocked(storage.insertIdentity).mockResolvedValue(
        createMockUserIdentity({ id: "i1", userId: "u1", provider: "apple" }),
      );
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ id: "u1", emailVerified: true }),
      );
      const res = await send();
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
      expect(revokeAppleToken).not.toHaveBeenCalled();
    });
  });

  it("repeat Apple sign-in with a stored token skips the exchange and tolerates no email", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      email: null,
    });
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({
        id: "i1",
        userId: "u1",
        provider: "apple",
        appleRefreshTokenEnc: "v1:x",
      }),
    );
    const user = createMockUser({ id: "u1", emailVerified: true });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    const res = await request(app()).post("/api/auth/social").send({
      provider: "apple",
      idToken: "t",
      nonce: "n",
      authorizationCode: "c",
    });
    expect(res.body.status).toBe("signed_in");
    expect(exchangeAppleCode).not.toHaveBeenCalled();
  });

  it("returning Apple user without a stored token gets one stored, scoped to that user", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      email: null,
    });
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({
        id: "i1",
        userId: "u1",
        provider: "apple",
        appleRefreshTokenEnc: null,
      }),
    );
    vi.mocked(exchangeAppleCode).mockResolvedValue("refresh-2");
    const user = createMockUser({ id: "u1", emailVerified: true });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    const res = await request(app()).post("/api/auth/social").send({
      provider: "apple",
      idToken: "t",
      nonce: "n",
      authorizationCode: "c",
    });
    expect(res.body.status).toBe("signed_in");
    expect(storage.setAppleRefreshToken).toHaveBeenCalledWith(
      "i1",
      "u1",
      expect.stringMatching(/^v1:/),
    );
    expect(storage.touchIdentity).toHaveBeenCalledWith("i1", "u1");
  });

  it("returning Apple user without a stored token still signs in when the exchange fails", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      email: null,
    });
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({
        id: "i1",
        userId: "u1",
        provider: "apple",
        appleRefreshTokenEnc: null,
      }),
    );
    vi.mocked(exchangeAppleCode).mockRejectedValue(new Error("apple down"));
    const user = createMockUser({ id: "u1", emailVerified: true });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    const res = await request(app()).post("/api/auth/social").send({
      provider: "apple",
      idToken: "t",
      nonce: "n",
      authorizationCode: "c",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("signed_in");
    expect(exchangeAppleCode).toHaveBeenCalled();
    expect(storage.setAppleRefreshToken).not.toHaveBeenCalled();
  });

  it("a linked Apple user stopped at a 403 gate never has a token revoked", async () => {
    // Revoking can end the whole Apple authorization of a real account. The
    // 403 here is EMAIL_NOT_VERIFIED (D1: no second-factor gate on this path).
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      email: null,
    });
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({
        id: "i1",
        userId: "u1",
        provider: "apple",
        appleRefreshTokenEnc: null,
      }),
    );
    vi.mocked(exchangeAppleCode).mockResolvedValue("fresh-refresh");
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({ id: "u1", emailVerified: false }),
    );
    const res = await request(app()).post("/api/auth/social").send({
      provider: "apple",
      idToken: "t",
      nonce: "n",
      authorizationCode: "c",
    });
    expect(res.status).toBe(403);
    expect(storage.setAppleRefreshToken).not.toHaveBeenCalled();
    expect(revokeAppleToken).not.toHaveBeenCalled();
  });

  it("issuing a ticket sweeps expired ones and revokes the Apple tokens they held", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.sweepExpiredPendingSignIns).mockResolvedValue([
      encryptToken("abandoned-refresh"),
    ]);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body.status).toBe("choose_username");
    await vi.waitFor(() =>
      expect(revokeAppleToken).toHaveBeenCalledWith(
        "abandoned-refresh",
        expect.anything(),
      ),
    );
  });

  it("sweeps only after this request's ticket exists, so its Apple ID counts as live", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    await request(app()).post("/api/auth/social").send(body);
    const created = vi.mocked(storage.createPendingSignIn).mock
      .invocationCallOrder[0];
    const swept = vi.mocked(storage.sweepExpiredPendingSignIns).mock
      .invocationCallOrder[0];
    expect(swept).toBeGreaterThan(created);
  });

  it("a failing sweep never blocks the sign-in", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.sweepExpiredPendingSignIns).mockRejectedValue(
      new Error("db hiccup"),
    );
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("choose_username");
    expect(revokeAppleToken).not.toHaveBeenCalled();
  });

  it("a signed-in returning user triggers no sweep", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({ id: "i1", userId: "u1", provider: "google" }),
    );
    const user = createMockUser({ id: "u1", emailVerified: true });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    await request(app()).post("/api/auth/social").send(body);
    expect(storage.sweepExpiredPendingSignIns).not.toHaveBeenCalled();
  });

  it("first Apple sign-in stores the name and encrypted refresh token on the ticket", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      email: "me@icloud.com",
    });
    vi.mocked(exchangeAppleCode).mockResolvedValue("refresh-1");
    await request(app())
      .post("/api/auth/social")
      .send({
        provider: "apple",
        idToken: "t",
        nonce: "n",
        authorizationCode: "c",
        fullName: { givenName: "Ann", familyName: "Lee" },
      });
    const input = vi.mocked(storage.createPendingSignIn).mock.calls[0][0];
    expect(input.displayName).toBe("Ann Lee");
    expect(input.appleRefreshTokenEnc).toMatch(/^v1:/);
    expect(input.appleRefreshTokenEnc).not.toContain("refresh-1");
  });

  it("D1: an already-linked Google sign-in on an MFA account goes straight in", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({
        id: "i1",
        userId: "u1",
        provider: "google",
      }),
    );
    const user = createMockUser({
      id: "u1",
      emailVerified: true,
      mfaEnabledAt: new Date(),
    });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("signed_in");
    expect(typeof res.body.token).toBe("string");
  });

  it("an MFA account is never auto-linked by email (link_required instead)", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(
      createMockUser({
        id: "u1",
        email: "me@gmail.com",
        emailVerified: true,
        mfaEnabledAt: new Date(),
      }),
    );
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body.status).toBe("link_required");
    expect(storage.insertIdentity).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/social/complete-sign-up", () => {
  it("creates the account and signs in", async () => {
    const user = createMockUser({
      id: "u2",
      username: "new_name",
      emailVerified: true,
    });
    vi.mocked(storage.createUserWithIdentity).mockResolvedValue(user);
    const res = await request(app())
      .post("/api/auth/social/complete-sign-up")
      .send({ ticket: "t", username: "new_name", ageConfirmed: true });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("signed_in");
  });
  it("400 without the age confirmation", async () => {
    const res = await request(app())
      .post("/api/auth/social/complete-sign-up")
      .send({ ticket: "t", username: "new_name", ageConfirmed: false });
    expect(res.status).toBe(400);
  });
  it("409 on a username race (unique violation), never 500", async () => {
    const err = Object.assign(new Error("dup"), {
      code: "23505",
      constraint: "users_username_unique",
    });
    vi.mocked(storage.createUserWithIdentity).mockRejectedValue(err);
    const res = await request(app())
      .post("/api/auth/social/complete-sign-up")
      .send({ ticket: "t", username: "new_name", ageConfirmed: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });
  it("409 EMAIL_IN_USE when the email was registered meanwhile", async () => {
    const err = Object.assign(new Error("dup"), {
      code: "23505",
      constraint: "users_email_lower_unique",
    });
    vi.mocked(storage.createUserWithIdentity).mockRejectedValue(err);
    const res = await request(app())
      .post("/api/auth/social/complete-sign-up")
      .send({ ticket: "t", username: "new_name", ageConfirmed: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_IN_USE");
  });
  it("400 INVALID_SIGN_IN_TICKET for a spent ticket", async () => {
    vi.mocked(storage.createUserWithIdentity).mockResolvedValue(undefined);
    const res = await request(app())
      .post("/api/auth/social/complete-sign-up")
      .send({ ticket: "t", username: "new_name", ageConfirmed: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SIGN_IN_TICKET");
  });
});

describe("POST /api/auth/social/link", () => {
  const ticketRow = createMockPendingSocialSignIn({
    kind: "link",
    provider: "google",
    providerSubject: "g-1",
    email: "me@yahoo.com",
    providerAuthoritative: false,
    targetUserId: "u1",
    attempts: 1,
  });

  it("wrong password → 401 and the ticket survives (no completeLink call)", async () => {
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(ticketRow);
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({
        id: "u1",
        password: await bcrypt.hash("right-pass1", 4),
      }),
    );
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", password: "wrong-pass1" });
    expect(res.status).toBe(401);
    expect(storage.completeLinkFromTicket).not.toHaveBeenCalled();
  });

  it("right password → links and signs in", async () => {
    const user = createMockUser({
      id: "u1",
      emailVerified: true,
      mfaEnabledAt: null,
      password: await bcrypt.hash("right-long-pass-1", 4),
    });
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(ticketRow);
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    vi.mocked(storage.completeLinkFromTicket).mockResolvedValue(
      createMockUserIdentity({
        id: "i9",
      }),
    );
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", password: "right-long-pass-1" });
    expect(res.body.status).toBe("signed_in");
    expect(storage.completeLinkFromTicket).toHaveBeenCalledWith("t", {
      markEmailVerified: false,
    });
    expect(storage.createUpgradePass).not.toHaveBeenCalled();
  });

  it("no two-step, right 11-character password → links and signs in, no upgrade pass (owner ruling 2026-10-12)", async () => {
    const user = createMockUser({
      id: "u1",
      emailVerified: true,
      mfaEnabledAt: null,
      password: await bcrypt.hash("right-pass1", 4), // 11
    });
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(ticketRow);
    vi.mocked(storage.createUpgradePass).mockReset();
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    vi.mocked(storage.completeLinkFromTicket).mockResolvedValue(
      createMockUserIdentity({ id: "i9" }),
    );
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", password: "right-pass1" });
    expect(res.body.status).toBe("signed_in");
    expect(storage.completeLinkFromTicket).toHaveBeenCalledTimes(1);
    expect(storage.createUpgradePass).not.toHaveBeenCalled();
  });

  it("an already-linked provider as proof is never gated, even on a short-password account", async () => {
    vi.mocked(storage.getPendingSignIn).mockResolvedValue(ticketRow);
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      sub: "a-1",
    });
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({ id: "x", userId: "u1", provider: "apple" }),
    );
    const user = createMockUser({
      id: "u1",
      emailVerified: true,
      mfaEnabledAt: null,
      password: await bcrypt.hash("short", 4),
    });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    vi.mocked(storage.completeLinkFromTicket).mockResolvedValue(
      createMockUserIdentity({ id: "i9" }),
    );
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", provider: "apple", idToken: "i", nonce: "n" });
    expect(res.body.status).toBe("signed_in");
    expect(storage.createUpgradePass).not.toHaveBeenCalled();
  });

  it("MFA account: right password → 200 mfa_required, nothing linked, no session", async () => {
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(ticketRow);
    vi.mocked(storage.createMfaChallenge).mockResolvedValue(undefined);
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({
        id: "u1",
        emailVerified: true,
        tokenVersion: 3,
        mfaEnabledAt: new Date(),
        password: await bcrypt.hash("right-pass1", 4),
      }),
    );
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", password: "right-pass1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "mfa_required",
      challenge: expect.any(String),
    });
    expect(storage.completeLinkFromTicket).not.toHaveBeenCalled();
    expect(storage.getUser).not.toHaveBeenCalled(); // issueSession never ran
    const row = vi.mocked(storage.createMfaChallenge).mock.calls[0][0];
    expect(row).toMatchObject({
      userId: "u1",
      tokenVersion: 3,
      purpose: "link",
      linkMarkEmailVerified: false,
      notAfter: ticketRow.expiresAt,
    });
    const { sha256Hex } = await import("../../lib/social-identity/nonce");
    expect(row.linkTicketHash).toBe(sha256Hex("t"));
  });

  it("MFA account: an already-linked provider as proof links with no challenge (D1)", async () => {
    vi.mocked(storage.getPendingSignIn).mockResolvedValue(ticketRow);
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      sub: "a-1",
    });
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({ id: "x", userId: "u1", provider: "apple" }),
    );
    const user = createMockUser({
      id: "u1",
      emailVerified: true,
      mfaEnabledAt: new Date(),
    });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    vi.mocked(storage.completeLinkFromTicket).mockResolvedValue(
      createMockUserIdentity({ id: "i9" }),
    );
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", provider: "apple", idToken: "i", nonce: "n" });
    expect(res.body.status).toBe("signed_in");
    expect(storage.createMfaChallenge).not.toHaveBeenCalled();
  });

  it("provider proof must be an identity already linked to the target", async () => {
    vi.mocked(storage.getPendingSignIn).mockResolvedValue(ticketRow);
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      sub: "a-9",
    });
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({
        id: "x",
        userId: "someone-else",
        provider: "apple",
      }),
    );
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", provider: "apple", idToken: "i", nonce: "n" });
    expect(res.status).toBe(401);
    expect(storage.consumeNonce).toHaveBeenCalledWith("n", "link", null);
    expect(storage.completeLinkFromTicket).not.toHaveBeenCalled();
  });

  it("400 when attempts are exhausted or the ticket is gone", async () => {
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(undefined);
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", password: "x" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SIGN_IN_TICKET");
  });
});

// Auth audit 2026-10-11 L3 (as L12): a session is minted only under the
// tokenVersion of the row the route checked — a reset or sign-out-everywhere
// landing mid-request (getUser reads a moved version) wins.
describe("a version bump mid-request → no session (audit L3)", () => {
  const socialBody = { provider: "google", idToken: "t", nonce: "n" };
  const moved = (u: ReturnType<typeof createMockUser>) =>
    vi
      .mocked(storage.getUser)
      .mockResolvedValue({ ...u, tokenVersion: u.tokenVersion + 1 });

  function expectRefused(res: request.Response) {
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  }

  it("an already-linked identity's sign-in", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue(
      createMockUserIdentity({ id: "i1", userId: "u1", provider: "google" }),
    );
    const user = createMockUser({ id: "u1", emailVerified: true });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    moved(user);
    expectRefused(
      await request(app()).post("/api/auth/social").send(socialBody),
    );
  });

  it("an auto-link onto a password-less account", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    const user = createMockUser({
      id: "u1",
      email: "me@gmail.com",
      emailVerified: true,
      password: null,
    });
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(user);
    moved(user);
    expectRefused(
      await request(app()).post("/api/auth/social").send(socialBody),
    );
  });

  it("completing a social sign-up", async () => {
    const user = createMockUser({ id: "u2", emailVerified: true });
    vi.mocked(storage.createUserWithIdentity).mockResolvedValue(user);
    moved(user);
    expectRefused(
      await request(app())
        .post("/api/auth/social/complete-sign-up")
        .send({ ticket: "t", username: "new_name", ageConfirmed: true }),
    );
  });

  it("completing a link with the password", async () => {
    const user = createMockUser({
      id: "u1",
      emailVerified: true,
      mfaEnabledAt: null,
      password: await bcrypt.hash("right-long-pass-1", 4),
    });
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(
      createMockPendingSocialSignIn({
        kind: "link",
        provider: "google",
        providerSubject: "g-1",
        email: "me@yahoo.com",
        providerAuthoritative: false,
        targetUserId: "u1",
        attempts: 1,
      }),
    );
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.completeLinkFromTicket).mockResolvedValue(
      createMockUserIdentity({ id: "i9" }),
    );
    moved(user);
    expectRefused(
      await request(app())
        .post("/api/auth/social/link")
        .send({ ticket: "t", password: "right-long-pass-1" }),
    );
  });
});

describe("POST /api/auth/social/nonce", () => {
  it("issues a public sign_in nonce", async () => {
    vi.mocked(storage.issueNonce).mockResolvedValue({
      nonce: "n",
      nonceHash: "h",
    });
    const res = await request(app())
      .post("/api/auth/social/nonce")
      .send({ purpose: "sign_in" });
    expect(res.body).toEqual({ nonce: "n", nonceHash: "h" });
    expect(storage.issueNonce).toHaveBeenCalledWith("sign_in", null);
  });
  it("refuses an unauthenticated reauth nonce", async () => {
    const res = await request(app())
      .post("/api/auth/social/nonce")
      .send({ purpose: "reauth" });
    expect(res.status).toBe(401);
  });
});
