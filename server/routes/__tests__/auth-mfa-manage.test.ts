import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";

import { storage } from "../../storage";
import { register } from "../auth-mfa";
import { reauthenticate } from "../auth-social";
import {
  generateToken,
  invalidateTokenVersionCache,
} from "../../middleware/auth";
import { verifySecondFactor } from "../../lib/mfa/verify-second-factor";
import { sendTwoFactorNotice } from "../../services/email";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  hashRecoveryCode,
} from "../../lib/mfa/mfa-secrets";
import { base32Decode, base32Encode, hotp, timeStep } from "../../lib/mfa/totp";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getUserForAuth: vi.fn(),
    getUser: vi.fn(),
    startTotpEnrollment: vi.fn(),
    getPendingTotpSecret: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
    disableMfa: vi.fn(),
    replaceRecoveryCodes: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../auth-social", () => ({ reauthenticate: vi.fn() }));
vi.mock("../../lib/mfa/verify-second-factor", () => ({
  verifySecondFactor: vi.fn(),
}));
vi.mock("../../services/email", () => ({
  sendTwoFactorNotice: vi.fn().mockResolvedValue(undefined),
}));

const KEY = crypto.randomBytes(32);
const m = vi.mocked(storage);
const flush = () => new Promise((r) => setImmediate(r));
// requireAuth's mock sets req.userId = "1".
const plainUser = createMockUser({
  id: "1",
  email: "me@x.com",
  username: "chef",
  password: "hash",
  tokenVersion: 2,
  mfaEnabledAt: null,
});
const mfaUser = { ...plainUser, mfaEnabledAt: new Date("2026-10-05") };
const PROOF = { password: "right-pass1" };
const RECOVERY_PATTERN = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/;

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}
const post = (path: string, body: object) =>
  request(app()).post(path).send(body);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MFA_SECRET_ENC_KEY = KEY.toString("base64");
  vi.mocked(generateToken).mockReturnValue("fresh-token");
  vi.mocked(reauthenticate).mockResolvedValue(true);
  m.getUserForAuth.mockResolvedValue(plainUser);
  m.getUser.mockResolvedValue(plainUser);
  vi.mocked(verifySecondFactor).mockResolvedValue({
    ok: true,
    usedRecoveryCode: false,
  });
});

describe("POST /api/auth/mfa/totp/setup", () => {
  it("after re-auth, stores an encrypted candidate and returns the key and link", async () => {
    const res = await post("/api/auth/mfa/totp/setup", { proof: PROOF });
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.body.otpauthUrl).toBe(
      `otpauth://totp/OCRecipes:chef?secret=${res.body.secret}&issuer=OCRecipes&algorithm=SHA1&digits=6&period=30`,
    );
    expect(reauthenticate).toHaveBeenCalledWith("1", "hash", PROOF);
    const [userId, enc] = m.startTotpEnrollment.mock.calls[0];
    expect(userId).toBe("1");
    expect(enc).not.toContain(res.body.secret);
    expect(decryptMfaSecret(enc, KEY)).toBe(res.body.secret);
  });

  it("a failed re-auth returns 401 and no secret", async () => {
    vi.mocked(reauthenticate).mockResolvedValue(false);
    const res = await post("/api/auth/mfa/totp/setup", { proof: PROOF });
    expect(res.status).toBe(401);
    expect(res.body.secret).toBeUndefined();
    expect(m.startTotpEnrollment).not.toHaveBeenCalled();
  });

  it("already on → 409 MFA_ALREADY_ENABLED", async () => {
    m.getUserForAuth.mockResolvedValue(mfaUser);
    const res = await post("/api/auth/mfa/totp/setup", { proof: PROOF });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_ALREADY_ENABLED");
  });

  it("no MFA_SECRET_ENC_KEY → 503 MFA_UNAVAILABLE before any re-auth", async () => {
    delete process.env.MFA_SECRET_ENC_KEY;
    const res = await post("/api/auth/mfa/totp/setup", { proof: PROOF });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MFA_UNAVAILABLE");
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it("a body without a proof → 400", async () => {
    const res = await post("/api/auth/mfa/totp/setup", {});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/mfa/totp/confirm", () => {
  const SECRET = crypto.randomBytes(20);

  beforeEach(() => {
    m.getPendingTotpSecret.mockResolvedValue(
      encryptMfaSecret(base32Encode(SECRET), KEY),
    );
  });

  it("a right code turns 2FA on, returns 10 codes and a token minted AFTER the version bump", async () => {
    m.confirmTotpEnrollment.mockResolvedValue(3);
    m.getUser.mockResolvedValue({ ...mfaUser, tokenVersion: 3 });
    const code = hotp(SECRET, timeStep(Date.now()));
    const res = await post("/api/auth/mfa/totp/confirm", { code });
    await flush();
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("fresh-token");
    expect(generateToken).toHaveBeenCalledWith("1", 3, plainUser.emailVerified);
    expect(res.body.recoveryCodes).toHaveLength(10);
    for (const c of res.body.recoveryCodes) expect(c).toMatch(RECOVERY_PATTERN);
    const [, opts] = m.confirmTotpEnrollment.mock.calls[0];
    expect(opts.acceptedStep).toBeGreaterThanOrEqual(timeStep(Date.now()) - 1);
    expect(opts.recoveryHashes).toEqual(
      res.body.recoveryCodes.map((c: string) =>
        hashRecoveryCode("1", c.replace(/-/g, "")),
      ),
    );
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "me@x.com",
      "chef",
      "enabled",
    );
  });

  it("a wrong code → 400 MFA_CODE_INVALID, nothing enabled", async () => {
    const right = hotp(SECRET, timeStep(Date.now()));
    const wrong = right === "000000" ? "111111" : "000000";
    const res = await post("/api/auth/mfa/totp/confirm", { code: wrong });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MFA_CODE_INVALID");
    expect(m.confirmTotpEnrollment).not.toHaveBeenCalled();
  });

  it("no setup in progress → 400 MFA_CODE_INVALID", async () => {
    m.getPendingTotpSecret.mockResolvedValue(undefined);
    const res = await post("/api/auth/mfa/totp/confirm", { code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MFA_CODE_INVALID");
  });

  it("already confirmed elsewhere → 409 MFA_ALREADY_ENABLED", async () => {
    m.confirmTotpEnrollment.mockResolvedValue(undefined);
    const code = hotp(SECRET, timeStep(Date.now()));
    const res = await post("/api/auth/mfa/totp/confirm", { code });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_ALREADY_ENABLED");
  });

  it("the setup key round-trips through base32", () => {
    expect(base32Decode(base32Encode(SECRET))).toEqual(SECRET);
  });
});

describe("POST /api/auth/mfa/disable", () => {
  beforeEach(() => {
    m.getUserForAuth.mockResolvedValue(mfaUser);
  });

  it("re-auth + a right code turns 2FA off and hands back a fresh token", async () => {
    m.disableMfa.mockResolvedValue(3);
    m.getUser.mockResolvedValue({ ...plainUser, tokenVersion: 3 });
    const res = await post("/api/auth/mfa/disable", {
      proof: PROOF,
      code: "123456",
    });
    await flush();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "signed_in",
      token: "fresh-token",
    });
    expect(verifySecondFactor).toHaveBeenCalledWith("1", { code: "123456" });
    expect(m.disableMfa).toHaveBeenCalledWith("1");
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "me@x.com",
      "chef",
      "disabled",
    );
  });

  it("accepts a recovery code as the second factor", async () => {
    m.disableMfa.mockResolvedValue(3);
    const res = await post("/api/auth/mfa/disable", {
      proof: PROOF,
      recoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    expect(res.status).toBe(200);
    expect(verifySecondFactor).toHaveBeenCalledWith("1", {
      recoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
  });

  it("needs BOTH the re-auth and the code", async () => {
    expect((await post("/api/auth/mfa/disable", { proof: PROOF })).status).toBe(
      400,
    );
    expect(
      (await post("/api/auth/mfa/disable", { code: "123456" })).status,
    ).toBe(400);
    vi.mocked(reauthenticate).mockResolvedValue(false);
    expect(
      (await post("/api/auth/mfa/disable", { proof: PROOF, code: "123456" }))
        .status,
    ).toBe(401);
    expect(m.disableMfa).not.toHaveBeenCalled();
  });

  it("a wrong code → 401 MFA_CODE_INVALID; locked → 429", async () => {
    vi.mocked(verifySecondFactor).mockResolvedValueOnce({
      ok: false,
      reason: "invalid",
    });
    const bad = await post("/api/auth/mfa/disable", {
      proof: PROOF,
      code: "123456",
    });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe("MFA_CODE_INVALID");
    vi.mocked(verifySecondFactor).mockResolvedValueOnce({
      ok: false,
      reason: "locked",
    });
    const locked = await post("/api/auth/mfa/disable", {
      proof: PROOF,
      code: "123456",
    });
    expect(locked.status).toBe(429);
    expect(m.disableMfa).not.toHaveBeenCalled();
  });

  it("not on → 409 MFA_NOT_ENABLED", async () => {
    m.getUserForAuth.mockResolvedValue(plainUser);
    const res = await post("/api/auth/mfa/disable", {
      proof: PROOF,
      code: "123456",
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_NOT_ENABLED");
  });
});

describe("POST /api/auth/mfa/recovery-codes", () => {
  beforeEach(() => {
    m.getUserForAuth.mockResolvedValue(mfaUser);
  });

  it("re-auth + a right code replaces the set and returns the new codes", async () => {
    const res = await post("/api/auth/mfa/recovery-codes", {
      proof: PROOF,
      code: "123456",
    });
    await flush();
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
    const [userId, hashes] = m.replaceRecoveryCodes.mock.calls[0];
    expect(userId).toBe("1");
    expect(hashes).toEqual(
      res.body.recoveryCodes.map((c: string) =>
        hashRecoveryCode("1", c.replace(/-/g, "")),
      ),
    );
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "me@x.com",
      "chef",
      "recovery_codes_replaced",
    );
  });

  it("a recovery code is NOT accepted to mint new codes", async () => {
    const res = await post("/api/auth/mfa/recovery-codes", {
      proof: PROOF,
      recoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    expect(res.status).toBe(400);
    expect(m.replaceRecoveryCodes).not.toHaveBeenCalled();
  });

  it("a wrong code → 401 and nothing replaced", async () => {
    vi.mocked(verifySecondFactor).mockResolvedValue({
      ok: false,
      reason: "invalid",
    });
    const res = await post("/api/auth/mfa/recovery-codes", {
      proof: PROOF,
      code: "123456",
    });
    expect(res.status).toBe(401);
    expect(m.replaceRecoveryCodes).not.toHaveBeenCalled();
  });
});
