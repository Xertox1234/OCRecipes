import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { storage } from "../../storage";
import { register } from "../auth-mfa";
import {
  generateToken,
  invalidateTokenVersionCache,
  requireAuth,
} from "../../middleware/auth";
import {
  sendTwoFactorNotice,
  sendPasswordChangedNotice,
} from "../../services/email";
import { passwordMatches } from "../../lib/password-check";
import { isBreached } from "../../lib/pwned-password";
import {
  encryptMfaSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "../../lib/mfa/mfa-secrets";
import { base32Decode, hotp, timeStep } from "../../lib/mfa/totp";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUserForAuth: vi.fn(),
    getUser: vi.fn(),
    startTotpEnrollment: vi.fn(),
    getPendingTotpSecret: vi.fn(),
    recordMfaFailure: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
    confirmNewPhone: vi.fn(),
    disableMfa: vi.fn(),
    replaceRecoveryCodes: vi.fn(),
    forgetTrustedDevices: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

// Never call api.pwnedpasswords.com from a test.
vi.mock("../../lib/pwned-password", () => ({
  isBreached: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../services/email", () => ({
  sendTwoFactorNotice: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
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

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const currentCode = () => hotp(base32Decode(SECRET), timeStep(Date.now()));
let passwordHash: string;
let saved: Record<string, string | undefined>;
// Turning two-step off needs a 15+ current password (spec §5.4).
const LONG_PASSWORD = "right-long-pass-1";
const SHORT_PASSWORD = "short-pass-1"; // 12
let longHash: string;
let shortHash: string;

const post = (path: string, body: object = {}) =>
  request(app())
    .post(`/api/auth/mfa/${path}`)
    .set("Authorization", "Bearer t")
    .send(body);

function asUser(over: Parameters<typeof createMockUser>[0] = {}) {
  const u = createMockUser({ password: passwordHash, ...over });
  vi.mocked(storage.getUserForAuth).mockResolvedValue(u);
  vi.mocked(storage.getUser).mockResolvedValue(u);
  return u;
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(generateToken).mockReturnValue("mock-jwt-token");
  // resetAllMocks clears the __mocks__ defaults too; re-seed requireAuth.
  vi.mocked(requireAuth).mockImplementation(async (req, _res, next) => {
    req.userId = "1";
    next();
  });
  vi.mocked(sendTwoFactorNotice).mockResolvedValue(undefined);
  vi.mocked(sendPasswordChangedNotice).mockResolvedValue(undefined);
  vi.mocked(storage.startTotpEnrollment).mockResolvedValue(true);
  saved = {
    MFA_SECRET_ENC_KEY: process.env.MFA_SECRET_ENC_KEY,
    MFA_SETUP_ENABLED: process.env.MFA_SETUP_ENABLED,
  };
  process.env.MFA_SECRET_ENC_KEY = crypto.randomBytes(32).toString("base64");
  process.env.MFA_SETUP_ENABLED = "true";
  passwordHash ??= await bcrypt.hash("right-pass1", 4);
  asUser();
  mockVerifySecondFactor.mockResolvedValue({ ok: true });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("POST /api/auth/mfa/totp/setup", () => {
  // Auth audit 2026-10-10 L13: setup stages for an MFA-OFF account only.
  it("stages as setup (MFA off); a confirm that won the race → 409", async () => {
    vi.mocked(storage.startTotpEnrollment).mockResolvedValue(false);
    const res = await post("totp/setup", { password: "right-pass1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_ALREADY_ENABLED");
    expect(vi.mocked(storage.startTotpEnrollment).mock.calls[0][2]).toEqual({
      mfaEnabled: false,
    });
  });
  it("right password → a secret and an authenticator link; only the encrypted secret is stored", async () => {
    const res = await post("totp/setup", { password: "right-pass1" });
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.body.otpauthUrl).toContain(`secret=${res.body.secret}`);
    expect(res.body.otpauthUrl).toContain("OCRecipes:testuser");
    const [, stored] = vi.mocked(storage.startTotpEnrollment).mock.calls[0];
    expect(stored).not.toContain(res.body.secret);
    expect(stored).toMatch(/^v1:/);
  });

  it("is off unless MFA_SETUP_ENABLED is exactly 'true' — even with the right password", async () => {
    delete process.env.MFA_SETUP_ENABLED;
    const res = await post("totp/setup", { password: "right-pass1" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MFA_SETUP_DISABLED");
    expect(storage.startTotpEnrollment).not.toHaveBeenCalled();
  });

  it("wrong password → 401 and no secret", async () => {
    const res = await post("totp/setup", { password: "wrong-pass1" });
    expect(res.status).toBe(401);
    expect(res.body.secret).toBeUndefined();
    expect(storage.startTotpEnrollment).not.toHaveBeenCalled();
  });

  it("a Google/Apple-only account (no password) → 409 MFA_NEEDS_PASSWORD", async () => {
    asUser({ password: null });
    const res = await post("totp/setup", { password: "anything" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_NEEDS_PASSWORD");
  });

  it("already on → 409 MFA_ALREADY_ENABLED", async () => {
    asUser({ mfaEnabledAt: new Date() });
    const res = await post("totp/setup", { password: "right-pass1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_ALREADY_ENABLED");
  });

  it("no MFA_SECRET_ENC_KEY → 503 MFA_UNAVAILABLE", async () => {
    delete process.env.MFA_SECRET_ENC_KEY;
    const res = await post("totp/setup", { password: "right-pass1" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MFA_UNAVAILABLE");
  });
});

describe("POST /api/auth/mfa/totp/confirm", () => {
  beforeEach(() => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      encryptMfaSecret(SECRET),
    );
    vi.mocked(storage.recordMfaFailure).mockResolvedValue({
      failedAttempts: 1,
      tripped: false,
    });
  });

  it("first setup → 10 recovery codes and a session minted AFTER the version bump", async () => {
    vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(4);
    asUser({ tokenVersion: 4 });
    const res = await post("totp/confirm", { code: currentCode() });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
    expect(res.body.token).toBe("mock-jwt-token");
    expect(generateToken).toHaveBeenCalledWith("1", 4, false);
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    const [, opts] = vi.mocked(storage.confirmTotpEnrollment).mock.calls[0];
    expect(opts.recoveryHashes).toEqual(
      res.body.recoveryCodes.map((c: string) =>
        hashRecoveryCode("1", normalizeRecoveryCode(c)!),
      ),
    );
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "testuser@example.com",
      "testuser",
      "enabled",
    );
  });

  it("on an account that already has MFA it confirms a NEW PHONE (no new codes)", async () => {
    asUser({ mfaEnabledAt: new Date(), tokenVersion: 2 });
    vi.mocked(storage.confirmNewPhone).mockResolvedValue(2);
    const res = await post("totp/confirm", { code: currentCode() });
    expect(res.status).toBe(200);
    expect(storage.confirmNewPhone).toHaveBeenCalled();
    expect(storage.confirmTotpEnrollment).not.toHaveBeenCalled();
    expect(res.body.recoveryCodes).toBeUndefined();
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "testuser@example.com",
      "testuser",
      "new_phone",
    );
  });

  // Auth audit 2026-10-11 L3 (as L12): the session is minted only under the
  // version the confirm set — a reset or sign-out-everywhere since then wins.
  it("first setup, then a version bump before the mint → 401, no session, the codes still ride", async () => {
    vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(4);
    asUser({ tokenVersion: 4 });
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({ password: passwordHash, tokenVersion: 5 }),
    );
    const res = await post("totp/confirm", { code: currentCode() });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(res.body.recoveryCodes).toHaveLength(10);
  });

  it("new phone, then a version bump before the mint → 401, no session", async () => {
    asUser({ mfaEnabledAt: new Date(), tokenVersion: 2 });
    vi.mocked(storage.confirmNewPhone).mockResolvedValue(2);
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({ password: passwordHash, tokenVersion: 3 }),
    );
    const res = await post("totp/confirm", { code: currentCode() });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it("a wrong code → 400 INVALID_SECOND_FACTOR, nothing confirmed", async () => {
    const wrong = String((Number(currentCode()) + 1) % 1_000_000).padStart(
      6,
      "0",
    );
    const res = await post("totp/confirm", { code: wrong });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
    expect(storage.confirmTotpEnrollment).not.toHaveBeenCalled();
  });

  // Auth audit 2026-10-10 L9: spec §6 — every path that checks a factor counts
  // failures toward the lock; confirm used to guess for free.
  it("a wrong code is counted toward the lock; tripping it sends the lock notice", async () => {
    const wrong = String((Number(currentCode()) + 1) % 1_000_000).padStart(
      6,
      "0",
    );
    vi.mocked(storage.recordMfaFailure).mockResolvedValueOnce({
      failedAttempts: 3,
      tripped: false,
    });
    await post("totp/confirm", { code: wrong });
    expect(storage.recordMfaFailure).toHaveBeenCalledWith("1");
    expect(sendTwoFactorNotice).not.toHaveBeenCalled();

    vi.mocked(storage.recordMfaFailure).mockResolvedValueOnce({
      failedAttempts: 10,
      tripped: true,
    });
    const res = await post("totp/confirm", { code: wrong });
    expect(res.status).toBe(400);
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "testuser@example.com",
      "testuser",
      "locked",
    );
  });

  it("no pending (or expired) setup → 400 INVALID_SECOND_FACTOR", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(undefined);
    const res = await post("totp/confirm", { code: currentCode() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
  });

  it("the storage guard refused (a concurrent confirm won) → 409", async () => {
    vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(undefined);
    const res = await post("totp/confirm", { code: currentCode() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_ALREADY_ENABLED");
  });
});

describe("POST /api/auth/mfa/totp/reset (new phone)", () => {
  beforeEach(() => {
    asUser({ mfaEnabledAt: new Date() });
  });

  it("password + current factor → a new pending secret", async () => {
    const res = await post("totp/reset", {
      password: "right-pass1",
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(storage.startTotpEnrollment).toHaveBeenCalled();
  });

  it("a recovery code (lost phone) → the response carries its replacement", async () => {
    mockVerifySecondFactor.mockResolvedValue({
      ok: true,
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    const res = await post("totp/reset", {
      password: "right-pass1",
      secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
    });
    expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
  });

  it("no MFA_SECRET_ENC_KEY → 503 BEFORE the factor is checked (a recovery code is not spent)", async () => {
    delete process.env.MFA_SECRET_ENC_KEY;
    const res = await post("totp/reset", {
      password: "right-pass1",
      secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
    });
    expect(res.status).toBe(503);
    expect(mockVerifySecondFactor).not.toHaveBeenCalled();
  });

  it("a recovery code then a failed write → 500 that still carries its replacement", async () => {
    mockVerifySecondFactor.mockResolvedValue({
      ok: true,
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    vi.mocked(storage.startTotpEnrollment).mockRejectedValue(new Error("db"));
    const res = await post("totp/reset", {
      password: "right-pass1",
      secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
    });
    expect(res.status).toBe(500);
    expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
  });

  it("wrong factor → 401 INVALID_SECOND_FACTOR, no secret", async () => {
    mockVerifySecondFactor.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await post("totp/reset", {
      password: "right-pass1",
      secondFactor: { code: "000000" },
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
    expect(res.body.secret).toBeUndefined();
  });

  it("MFA off → 409 MFA_NOT_ENABLED", async () => {
    asUser();
    const res = await post("totp/reset", {
      password: "right-pass1",
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_NOT_ENABLED");
  });

  it("wrong password → 401 UNAUTHORIZED before the factor is checked", async () => {
    const res = await post("totp/reset", {
      password: "wrong-pass1",
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
    expect(mockVerifySecondFactor).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/mfa/disable", () => {
  beforeEach(async () => {
    longHash ??= await bcrypt.hash(LONG_PASSWORD, 4);
    asUser({ password: longHash, mfaEnabledAt: new Date() });
  });

  // Auth audit 2026-10-10 L11: once a recovery code is spent, a later failure
  // must still hand back its replacement (the 10-10 spent-credential rule).
  it("a recovery code then a failed write → 500 that still carries its replacement", async () => {
    mockVerifySecondFactor.mockResolvedValue({
      ok: true,
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    vi.mocked(storage.disableMfa).mockRejectedValue(new Error("db"));
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
    });
    expect(res.status).toBe(500);
    expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
  });

  it("password + factor → off, sessions end, notice sent, a fresh session returned", async () => {
    vi.mocked(storage.disableMfa).mockResolvedValue(5);
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({ password: longHash, tokenVersion: 5 }),
    );
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("mock-jwt-token");
    const [id, opts] = vi.mocked(storage.disableMfa).mock.calls[0];
    expect(id).toBe("1");
    expect(opts?.newPasswordHash).toBeUndefined();
    expect(sendPasswordChangedNotice).not.toHaveBeenCalled();
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "testuser@example.com",
      "testuser",
      "disabled",
    );
  });

  // Auth audit 2026-10-11 L3 (as L12).
  it("off, then a version bump before the mint → 401, no session", async () => {
    vi.mocked(storage.disableMfa).mockResolvedValue(5);
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({ password: longHash, tokenVersion: 6 }),
    );
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it("the account vanished under the write (disableMfa returned nothing) → 404, no session", async () => {
    vi.mocked(storage.disableMfa).mockResolvedValue(undefined);
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
    expect(storage.getUser).not.toHaveBeenCalled();
  });

  it("no factor → 400 (schema), nothing changed", async () => {
    const res = await post("disable", { password: LONG_PASSWORD });
    expect(res.status).toBe(400);
    expect(storage.disableMfa).not.toHaveBeenCalled();
  });

  it("wrong factor → 401, still on", async () => {
    mockVerifySecondFactor.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { code: "000000" },
    });
    expect(res.status).toBe(401);
    expect(storage.disableMfa).not.toHaveBeenCalled();
  });

  it("unreadable secret → 503", async () => {
    mockVerifySecondFactor.mockResolvedValue({
      ok: false,
      reason: "unavailable",
    });
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MFA_UNAVAILABLE");
  });

  describe("a password under 15 needs a new 15+ one in the same step (spec §5.4)", () => {
    beforeEach(async () => {
      shortHash ??= await bcrypt.hash(SHORT_PASSWORD, 4);
      asUser({ password: shortHash, mfaEnabledAt: new Date() });
      vi.mocked(isBreached).mockResolvedValue(false);
    });

    it("no newPassword: 400 PASSWORD_UPGRADE_NEEDED before the factor is checked", async () => {
      const res = await post("disable", {
        password: SHORT_PASSWORD,
        secondFactor: { recoveryCode: "ABCD-EFGH-IJKL-MNOP" },
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PASSWORD_UPGRADE_NEEDED");
      expect(mockVerifySecondFactor).not.toHaveBeenCalled(); // no recovery code spent
      expect(storage.disableMfa).not.toHaveBeenCalled();
    });

    it("a wrong current password still answers 401, never the upgrade prompt", async () => {
      const res = await post("disable", {
        password: "wrong-pass1",
        secondFactor: { code: "123456" },
      });
      expect(res.status).toBe(401);
      expect(storage.disableMfa).not.toHaveBeenCalled();
    });

    it("a 15+ newPassword: turns off and changes the password in one call, then notifies", async () => {
      vi.mocked(storage.disableMfa).mockResolvedValue(6);
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ tokenVersion: 6 }),
      );
      const res = await post("disable", {
        password: SHORT_PASSWORD,
        secondFactor: { code: "123456" },
        newPassword: "a-long-test-passphrase",
      });
      expect(res.status).toBe(200);
      const [, opts] = vi.mocked(storage.disableMfa).mock.calls[0];
      expect(opts?.newPasswordHash).toMatch(/^pv2\$/);
      expect(
        await passwordMatches("a-long-test-passphrase", opts!.newPasswordHash!),
      ).toBe(true);
      expect(sendPasswordChangedNotice).toHaveBeenCalledWith(
        "testuser@example.com",
        "testuser",
      );
    });

    it("a short newPassword: 400 PASSWORD_TOO_SHORT, factor not checked, still on", async () => {
      const res = await post("disable", {
        password: SHORT_PASSWORD,
        secondFactor: { recoveryCode: "ABCD-EFGH-IJKL-MNOP" },
        newPassword: "still-short-1",
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PASSWORD_TOO_SHORT");
      expect(res.body.error).toBe("Use at least 15 characters.");
      expect(mockVerifySecondFactor).not.toHaveBeenCalled();
      expect(storage.disableMfa).not.toHaveBeenCalled();
    });

    it("a breached newPassword: 400 PASSWORD_BREACHED, factor not checked, still on", async () => {
      vi.mocked(isBreached).mockResolvedValue(true);
      const res = await post("disable", {
        password: SHORT_PASSWORD,
        secondFactor: { recoveryCode: "ABCD-EFGH-IJKL-MNOP" },
        newPassword: "a-long-test-passphrase",
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PASSWORD_BREACHED");
      expect(mockVerifySecondFactor).not.toHaveBeenCalled();
      expect(storage.disableMfa).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/auth/mfa/recovery-codes", () => {
  it("a recovery code then a failed replace → 500 that still carries its replacement (audit L11)", async () => {
    asUser({ mfaEnabledAt: new Date() });
    mockVerifySecondFactor.mockResolvedValue({
      ok: true,
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    vi.mocked(storage.replaceRecoveryCodes).mockRejectedValue(new Error("db"));
    const res = await post("recovery-codes", {
      password: "right-pass1",
      secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
    });
    expect(res.status).toBe(500);
    expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
  });

  it("password + factor → 10 new codes, old ones replaced, notice sent", async () => {
    asUser({ mfaEnabledAt: new Date() });
    const res = await post("recovery-codes", {
      password: "right-pass1",
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
    const [, hashes] = vi.mocked(storage.replaceRecoveryCodes).mock.calls[0];
    expect(hashes).toHaveLength(10);
    expect(hashes).not.toContain(res.body.recoveryCodes[0]);
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "testuser@example.com",
      "testuser",
      "recovery_codes_replaced",
    );
  });

  it("MFA off → 409 MFA_NOT_ENABLED", async () => {
    const res = await post("recovery-codes", {
      password: "right-pass1",
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/auth/mfa/trusted-devices", () => {
  it("forgets every trusted phone → 204", async () => {
    const res = await request(app())
      .delete("/api/auth/mfa/trusted-devices")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(204);
    expect(storage.forgetTrustedDevices).toHaveBeenCalledWith("1");
  });
});
