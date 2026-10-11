import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import { storage } from "../../storage";
import { register } from "../auth-upgrade";
import {
  generateToken,
  invalidateTokenVersionCache,
} from "../../middleware/auth";
import {
  sendTwoFactorNotice,
  sendPasswordChangedNotice,
} from "../../services/email";
import { isBreached } from "../../lib/pwned-password";
import { encryptMfaSecret } from "../../lib/mfa/mfa-secrets";
import { base32Decode, hotp, timeStep } from "../../lib/mfa/totp";
import { hashUpgradePassToken } from "../../lib/upgrade-pass";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getLiveUpgradePass: vi.fn(),
    getUserForAuth: vi.fn(),
    getUser: vi.fn(),
    reserveUpgradePassAttempt: vi.fn(),
    completePasswordUpgrade: vi.fn(),
    startTotpEnrollment: vi.fn(),
    getPendingTotpSecret: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
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

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}

const TOKEN = "p".repeat(43);
const ID_HASH = hashUpgradePassToken(TOKEN);
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const currentCode = () => hotp(base32Decode(SECRET), timeStep(Date.now()));
const LONG = "a much longer password 2026";
let saved: Record<string, string | undefined>;

const post = (path: string, body: object = {}, auth = `UpgradePass ${TOKEN}`) =>
  request(app())
    .post(`/api/auth/upgrade/${path}`)
    .set("Authorization", auth)
    .send(body);

function livePass(over: { twoStepAllowed?: boolean } = {}) {
  vi.mocked(storage.getLiveUpgradePass).mockResolvedValue({
    idHash: ID_HASH,
    userId: "1",
    tokenVersion: 0,
    attempts: 0,
    twoStepAllowed: over.twoStepAllowed ?? true,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    createdAt: new Date(),
  });
}

function expectExpired(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.body.code).toBe("UPGRADE_PASS_EXPIRED");
  expect(res.body.token).toBeUndefined();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(generateToken).mockReturnValue("mock-jwt-token");
  vi.mocked(isBreached).mockResolvedValue(false);
  vi.mocked(sendTwoFactorNotice).mockResolvedValue(undefined);
  vi.mocked(sendPasswordChangedNotice).mockResolvedValue(undefined);
  const u = createMockUser({ id: "1", tokenVersion: 0, mfaEnabledAt: null });
  vi.mocked(storage.getUserForAuth).mockResolvedValue(u);
  vi.mocked(storage.getUser).mockResolvedValue(u);
  livePass();
  saved = {
    MFA_SECRET_ENC_KEY: process.env.MFA_SECRET_ENC_KEY,
    MFA_SETUP_ENABLED: process.env.MFA_SETUP_ENABLED,
  };
  process.env.MFA_SECRET_ENC_KEY = crypto.randomBytes(32).toString("base64");
  process.env.MFA_SETUP_ENABLED = "true";
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("POST /api/auth/upgrade/totp/setup", () => {
  it("a live pass → a secret, staged for the pass's user, no password asked", async () => {
    const res = await post("totp/setup");
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(vi.mocked(storage.startTotpEnrollment).mock.calls[0][0]).toBe("1");
  });

  it("MFA_SETUP_ENABLED off → 403 MFA_SETUP_DISABLED, nothing staged", async () => {
    delete process.env.MFA_SETUP_ENABLED;
    const res = await post("totp/setup");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MFA_SETUP_DISABLED");
    expect(storage.startTotpEnrollment).not.toHaveBeenCalled();
  });

  it("a pass from a password under 8 → 403 UPGRADE_TWO_STEP_NOT_ALLOWED, nothing staged", async () => {
    livePass({ twoStepAllowed: false });
    const res = await post("totp/setup");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UPGRADE_TWO_STEP_NOT_ALLOWED");
    expect(storage.startTotpEnrollment).not.toHaveBeenCalled();
  });

  it("no MFA_SECRET_ENC_KEY → 503 MFA_UNAVAILABLE", async () => {
    delete process.env.MFA_SECRET_ENC_KEY;
    const res = await post("totp/setup");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MFA_UNAVAILABLE");
  });

  it("a Bearer token is never accepted", async () => {
    expectExpired(await post("totp/setup", {}, "Bearer mock-jwt-token"));
    expect(storage.startTotpEnrollment).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/upgrade/totp/confirm", () => {
  beforeEach(() => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      encryptMfaSecret(SECRET),
    );
    vi.mocked(storage.reserveUpgradePassAttempt).mockResolvedValue({
      idHash: ID_HASH,
      userId: "1",
      tokenVersion: 0,
      attempts: 1,
      twoStepAllowed: true,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
    });
    vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(1);
  });

  it("right code → a session and 10 recovery codes; the pass is consumed with the enrolment", async () => {
    const res = await post("totp/confirm", { code: currentCode() });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("mock-jwt-token");
    expect(res.body.recoveryCodes).toHaveLength(10);
    expect(storage.reserveUpgradePassAttempt).toHaveBeenCalledWith(ID_HASH);
    const [, opts] = vi.mocked(storage.confirmTotpEnrollment).mock.calls[0];
    expect(opts.upgradePass).toEqual({ idHash: ID_HASH, tokenVersion: 0 });
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "enabled_at_sign_in",
    );
  });

  it("the attempt is reserved BEFORE the code is checked", async () => {
    await post("totp/confirm", { code: currentCode() });
    expect(
      vi.mocked(storage.reserveUpgradePassAttempt).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(storage.getPendingTotpSecret).mock.invocationCallOrder[0],
    );
  });

  it("wrong code → 400 INVALID_SECOND_FACTOR; the attempt still counted; nothing confirmed", async () => {
    const wrong = currentCode() === "000000" ? "111111" : "000000";
    const res = await post("totp/confirm", { code: wrong });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
    expect(storage.reserveUpgradePassAttempt).toHaveBeenCalledTimes(1);
    expect(storage.confirmTotpEnrollment).not.toHaveBeenCalled();
  });

  it("no attempt left (dead or capped) → 401 UPGRADE_PASS_EXPIRED; the code is never checked", async () => {
    vi.mocked(storage.reserveUpgradePassAttempt).mockResolvedValue(undefined);
    expectExpired(await post("totp/confirm", { code: currentCode() }));
    expect(storage.getPendingTotpSecret).not.toHaveBeenCalled();
  });

  it("the storage guard refused (a concurrent confirm won) → 401, no session", async () => {
    vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(undefined);
    expectExpired(await post("totp/confirm", { code: currentCode() }));
    expect(generateToken).not.toHaveBeenCalled();
  });

  it("a malformed code → 400 VALIDATION_ERROR, no attempt spent", async () => {
    const res = await post("totp/confirm", { code: "12ab" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(storage.reserveUpgradePassAttempt).not.toHaveBeenCalled();
  });

  it("a pass from a password under 8 → 403, no attempt spent", async () => {
    livePass({ twoStepAllowed: false });
    const res = await post("totp/confirm", { code: currentCode() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UPGRADE_TWO_STEP_NOT_ALLOWED");
    expect(storage.reserveUpgradePassAttempt).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/upgrade/password", () => {
  beforeEach(() => {
    vi.mocked(storage.completePasswordUpgrade).mockResolvedValue(1);
  });

  it("15+ characters → a session; the pv2 hash written with the pass, tokenVersion and user", async () => {
    const res = await post("password", { newPassword: LONG });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("mock-jwt-token");
    const [args] = vi.mocked(storage.completePasswordUpgrade).mock.calls[0];
    expect(args).toEqual({
      idHash: ID_HASH,
      userId: "1",
      tokenVersion: 0,
      newPasswordHash: expect.stringMatching(/^pv2\$/),
    });
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    expect(sendPasswordChangedNotice).toHaveBeenCalled();
  });

  it("14 characters → 400 PASSWORD_TOO_SHORT, nothing written, no attempt reserved", async () => {
    const res = await post("password", { newPassword: "a".repeat(14) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_SHORT");
    expect(res.body.error).toBe("Use at least 15 characters.");
    expect(storage.completePasswordUpgrade).not.toHaveBeenCalled();
    expect(storage.reserveUpgradePassAttempt).not.toHaveBeenCalled();
  });

  it("breached → 400 PASSWORD_BREACHED, nothing written", async () => {
    vi.mocked(isBreached).mockResolvedValue(true);
    const res = await post("password", { newPassword: LONG });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_BREACHED");
    expect(storage.completePasswordUpgrade).not.toHaveBeenCalled();
  });

  it("the transaction refused (pass used twice, or a reset elsewhere) → 401, no session, no notice", async () => {
    vi.mocked(storage.completePasswordUpgrade).mockResolvedValue(undefined);
    expectExpired(await post("password", { newPassword: LONG }));
    expect(sendPasswordChangedNotice).not.toHaveBeenCalled();
  });

  it("no body → 400 VALIDATION_ERROR", async () => {
    const res = await post("password", {});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
