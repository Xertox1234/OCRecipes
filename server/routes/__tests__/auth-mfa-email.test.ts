import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { storage } from "../../storage";
import { register } from "../auth-mfa";
import {
  generateToken,
  invalidateTokenVersionCache,
  requireAuth,
} from "../../middleware/auth";
import { sendSignInCode, sendTwoFactorNotice } from "../../services/email";
import { hashChallengeToken } from "../../lib/mfa/mfa-secrets";
import { hashSignInCode } from "../../lib/password-reset-code";
import { createMockUser } from "../../__tests__/factories";
import type { MfaChallenge } from "@shared/schema";

// Two-step by emailed code (owner ruling 4, 2026-10-12).

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUserForAuth: vi.fn(),
    getUser: vi.fn(),
    getMfaState: vi.fn(),
    issueMfaEmailCode: vi.fn(),
    reserveMfaEmailAttempt: vi.fn(),
    enableEmailMfa: vi.fn(),
    getLiveMfaChallenge: vi.fn(),
    recordMfaFailure: vi.fn(),
    replaceRecoveryCodes: vi.fn(),
    startTotpEnrollment: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../services/email", () => ({
  sendSignInCode: vi.fn(),
  sendTwoFactorNotice: vi.fn(),
}));
const { mockVerifySecondFactor } = vi.hoisted(() => ({
  mockVerifySecondFactor: vi.fn(),
}));
vi.mock("../../lib/mfa/verify-second-factor", () => ({
  verifySecondFactor: mockVerifySecondFactor,
}));

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}

const post = (path: string, body: object = {}, signedIn = true) => {
  const r = request(app()).post(`/api/auth/mfa/${path}`);
  return (signedIn ? r.set("Authorization", "Bearer t") : r).send(body);
};

let passwordHash: string;
let savedResend: string | undefined;

function asUser(over: Parameters<typeof createMockUser>[0] = {}) {
  const u = createMockUser({
    password: passwordHash,
    email: "william@gmail.com",
    emailVerified: true,
    ...over,
  });
  vi.mocked(storage.getUserForAuth).mockResolvedValue(u);
  vi.mocked(storage.getUser).mockResolvedValue(u);
  return u;
}

const EMAIL_STATE = {
  method: "email",
  failedAttempts: 0,
  locked: false,
} as const;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(generateToken).mockReturnValue("mock-jwt-token");
  vi.mocked(requireAuth).mockImplementation(async (req, _res, next) => {
    req.userId = "1";
    next();
  });
  vi.mocked(sendSignInCode).mockResolvedValue(undefined);
  vi.mocked(sendTwoFactorNotice).mockResolvedValue(undefined);
  vi.mocked(storage.issueMfaEmailCode).mockResolvedValue("issued");
  savedResend = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test";
  passwordHash ??= await bcrypt.hash("right-pass1", 4);
  asUser();
});
afterEach(() => {
  if (savedResend === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedResend;
});

describe("POST /api/auth/mfa/email/setup", () => {
  it("right password → emails a code and says where it went", async () => {
    const res = await post("email/setup", { password: "right-pass1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "code_sent",
      emailHint: "w•••@gmail.com",
    });
    const code = vi.mocked(sendSignInCode).mock.calls[0][1];
    expect(vi.mocked(sendSignInCode).mock.calls[0][0]).toBe(
      "william@gmail.com",
    );
    expect(storage.issueMfaEmailCode).toHaveBeenCalledWith(
      "1",
      hashSignInCode("1", code),
    );
  });

  it("is NOT gated by MFA_SETUP_ENABLED or the authenticator key", async () => {
    const saved = [
      process.env.MFA_SETUP_ENABLED,
      process.env.MFA_SECRET_ENC_KEY,
    ];
    delete process.env.MFA_SETUP_ENABLED;
    delete process.env.MFA_SECRET_ENC_KEY;
    try {
      const res = await post("email/setup", { password: "right-pass1" });
      expect(res.status).toBe(200);
    } finally {
      if (saved[0] !== undefined) process.env.MFA_SETUP_ENABLED = saved[0];
      if (saved[1] !== undefined) process.env.MFA_SECRET_ENC_KEY = saved[1];
    }
  });

  it("wrong password → 401, nothing sent", async () => {
    const res = await post("email/setup", { password: "wrong" });
    expect(res.status).toBe(401);
    expect(storage.issueMfaEmailCode).not.toHaveBeenCalled();
  });

  // Lockout guard: two-step must never turn on where codes can't arrive.
  it("refuses with 503 when the server can't send email", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await post("email/setup", { password: "right-pass1" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MFA_UNAVAILABLE");
    expect(storage.issueMfaEmailCode).not.toHaveBeenCalled();
  });

  it("refuses an unconfirmed email address", async () => {
    asUser({ emailVerified: false });
    const res = await post("email/setup", { password: "right-pass1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("refuses when two-step is already on", async () => {
    asUser({ mfaEnabledAt: new Date() });
    const res = await post("email/setup", { password: "right-pass1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_ALREADY_ENABLED");
  });

  it("a Google/Apple-only account (no password) → MFA_NEEDS_PASSWORD", async () => {
    asUser({ password: null });
    const res = await post("email/setup", { password: "x" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_NEEDS_PASSWORD");
  });

  it.each([
    ["cooldown", "Wait a moment"],
    ["capped", "Too many codes"],
  ] as const)("%s → 429 with a plain reason, no email", async (r, words) => {
    vi.mocked(storage.issueMfaEmailCode).mockResolvedValue(r);
    const res = await post("email/setup", { password: "right-pass1" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
    expect(res.body.error).toContain(words);
    expect(sendSignInCode).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/mfa/email/confirm", () => {
  const CODE = "482913";
  beforeEach(() => {
    vi.mocked(storage.reserveMfaEmailAttempt).mockResolvedValue(
      hashSignInCode("1", CODE),
    );
    vi.mocked(storage.enableEmailMfa).mockResolvedValue(5);
  });

  it("the right code turns two-step on, sends the notice, and returns a fresh session", async () => {
    const after = createMockUser({
      tokenVersion: 5,
      email: "william@gmail.com",
    });
    vi.mocked(storage.getUser).mockResolvedValue(after);
    const res = await post("email/confirm", { code: CODE });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("mock-jwt-token");
    expect(res.body.recoveryCodes).toBeUndefined();
    expect(storage.enableEmailMfa).toHaveBeenCalledWith(
      "1",
      hashSignInCode("1", CODE),
    );
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    expect(vi.mocked(sendTwoFactorNotice).mock.calls[0][2]).toBe("enabled");
    expect(vi.mocked(generateToken).mock.calls[0][1]).toBe(5);
  });

  it("a wrong code → 400, nothing turned on", async () => {
    const res = await post("email/confirm", { code: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
    expect(storage.enableEmailMfa).not.toHaveBeenCalled();
  });

  it("no live code → 400", async () => {
    vi.mocked(storage.reserveMfaEmailAttempt).mockResolvedValue(undefined);
    const res = await post("email/confirm", { code: CODE });
    expect(res.status).toBe(400);
  });

  it("a code spent by a racing confirm → 400", async () => {
    vi.mocked(storage.enableEmailMfa).mockResolvedValue(undefined);
    const res = await post("email/confirm", { code: CODE });
    expect(res.status).toBe(400);
    expect(sendTwoFactorNotice).not.toHaveBeenCalled();
  });

  it("already on → 409 without spending a guess", async () => {
    asUser({ mfaEnabledAt: new Date() });
    const res = await post("email/confirm", { code: CODE });
    expect(res.status).toBe(409);
    expect(storage.reserveMfaEmailAttempt).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/mfa/email/resend (sign-in screen, no session)", () => {
  const CHALLENGE = "c".repeat(43);
  beforeEach(() => {
    asUser({ mfaEnabledAt: new Date(), tokenVersion: 2 });
    const live: MfaChallenge = {
      tokenHash: hashChallengeToken(CHALLENGE),
      userId: "1",
      tokenVersion: 2,
      purpose: "login",
      linkTicketHash: null,
      linkMarkEmailVerified: false,
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    };
    vi.mocked(storage.getLiveMfaChallenge).mockResolvedValue(live);
    vi.mocked(storage.getMfaState).mockResolvedValue(EMAIL_STATE);
  });

  it("a live challenge → a new code to the account's email", async () => {
    const res = await post("email/resend", { challenge: CHALLENGE }, false);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("code_sent");
    expect(storage.getLiveMfaChallenge).toHaveBeenCalledWith(
      hashChallengeToken(CHALLENGE),
    );
    expect(vi.mocked(sendSignInCode).mock.calls[0][0]).toBe(
      "william@gmail.com",
    );
  });

  it("a dead challenge → 401 expired, nothing sent", async () => {
    vi.mocked(storage.getLiveMfaChallenge).mockResolvedValue(undefined);
    const res = await post("email/resend", { challenge: CHALLENGE }, false);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_EXPIRED");
    expect(sendSignInCode).not.toHaveBeenCalled();
  });

  it("a password reset since the challenge opened → 401 expired", async () => {
    asUser({ mfaEnabledAt: new Date(), tokenVersion: 3 });
    const res = await post("email/resend", { challenge: CHALLENGE }, false);
    expect(res.status).toBe(401);
    expect(sendSignInCode).not.toHaveBeenCalled();
  });

  it("an authenticator account → 409, nothing sent", async () => {
    vi.mocked(storage.getMfaState).mockResolvedValue({
      ...EMAIL_STATE,
      method: "totp",
    });
    const res = await post("email/resend", { challenge: CHALLENGE }, false);
    expect(res.status).toBe(409);
    expect(sendSignInCode).not.toHaveBeenCalled();
  });

  it("cooldown → 429", async () => {
    vi.mocked(storage.issueMfaEmailCode).mockResolvedValue("cooldown");
    const res = await post("email/resend", { challenge: CHALLENGE }, false);
    expect(res.status).toBe(429);
  });
});

describe("POST /api/auth/mfa/email/send (signed-in code fields)", () => {
  it("an email account → a code", async () => {
    asUser({ mfaEnabledAt: new Date() });
    vi.mocked(storage.getMfaState).mockResolvedValue(EMAIL_STATE);
    const res = await post("email/send");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "code_sent",
      emailHint: "w•••@gmail.com",
    });
  });

  it("two-step off → 409", async () => {
    const res = await post("email/send");
    expect(res.status).toBe(409);
    expect(sendSignInCode).not.toHaveBeenCalled();
  });

  it("an authenticator account → 409", async () => {
    asUser({ mfaEnabledAt: new Date() });
    vi.mocked(storage.getMfaState).mockResolvedValue({
      ...EMAIL_STATE,
      method: "totp",
    });
    const res = await post("email/send");
    expect(res.status).toBe(409);
  });
});

describe("authenticator-only actions refuse email accounts", () => {
  beforeEach(() => {
    asUser({ mfaEnabledAt: new Date() });
    vi.mocked(storage.getMfaState).mockResolvedValue(EMAIL_STATE);
    mockVerifySecondFactor.mockResolvedValue({ ok: true });
  });

  // Else a staged authenticator key would be promoted while the account
  // stays 'email' — and the code check would never look at it.
  it("new-phone authenticator setup → 409", async () => {
    const res = await post("totp/reset", {
      password: "right-pass1",
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(409);
    expect(storage.startTotpEnrollment).not.toHaveBeenCalled();
  });

  it("new recovery codes → 409", async () => {
    const res = await post("recovery-codes", {
      password: "right-pass1",
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(409);
    expect(storage.replaceRecoveryCodes).not.toHaveBeenCalled();
  });
});
