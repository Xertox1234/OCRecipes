import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { storage } from "../../../storage";
import { verifySecondFactor } from "../verify-second-factor";
import { base32Encode, hotp, timeStep } from "../totp";
import { encryptMfaSecret, hashRecoveryCode } from "../mfa-secrets";

vi.mock("../../../storage", () => ({
  storage: {
    getActiveTotp: vi.fn(),
    acceptTotpStep: vi.fn(),
    recordMfaFailure: vi.fn(),
    consumeRecoveryCode: vi.fn(),
  },
}));

const KEY = crypto.randomBytes(32);
const SECRET = crypto.randomBytes(20);
const NOW = 1_800_000_000_000;
const STEP = timeStep(NOW);
const USER = "user-1";
const GOOD_CODE = hotp(SECRET, STEP);

function active(
  overrides: Partial<{ failedAttempts: number; locked: boolean }> = {},
) {
  return {
    secretEnc: encryptMfaSecret(base32Encode(SECRET), KEY),
    lastStep: STEP - 5,
    failedAttempts: 0,
    locked: false,
    ...overrides,
  };
}

const m = vi.mocked(storage);

beforeEach(() => {
  vi.resetAllMocks();
  process.env.MFA_SECRET_ENC_KEY = KEY.toString("base64");
  m.recordMfaFailure.mockResolvedValue(1);
});

describe("verifySecondFactor — authenticator code", () => {
  it("a correct code passes and records the matched step", async () => {
    m.getActiveTotp.mockResolvedValue(active());
    m.acceptTotpStep.mockResolvedValue(true);
    expect(await verifySecondFactor(USER, { code: GOOD_CODE }, NOW)).toEqual({
      ok: true,
      usedRecoveryCode: false,
    });
    expect(m.acceptTotpStep).toHaveBeenCalledWith(USER, STEP);
    expect(m.recordMfaFailure).not.toHaveBeenCalled();
  });

  it("a correct code whose step was already used fails and counts once", async () => {
    m.getActiveTotp.mockResolvedValue(active());
    m.acceptTotpStep.mockResolvedValue(false);
    expect(await verifySecondFactor(USER, { code: GOOD_CODE }, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(m.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("a wrong code fails and counts once", async () => {
    m.getActiveTotp.mockResolvedValue(active());
    const wrong = GOOD_CODE === "000000" ? "111111" : "000000";
    expect(await verifySecondFactor(USER, { code: wrong }, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(m.acceptTotpStep).not.toHaveBeenCalled();
    expect(m.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("a locked account answers locked without counting or checking the code", async () => {
    m.getActiveTotp.mockResolvedValue(active({ locked: true }));
    expect(await verifySecondFactor(USER, { code: GOOD_CODE }, NOW)).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(m.acceptTotpStep).not.toHaveBeenCalled();
    expect(m.recordMfaFailure).not.toHaveBeenCalled();
  });

  it("at 100 consecutive failures even a correct app code is refused", async () => {
    m.getActiveTotp.mockResolvedValue(active({ failedAttempts: 100 }));
    expect(await verifySecondFactor(USER, { code: GOOD_CODE }, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(m.acceptTotpStep).not.toHaveBeenCalled();
    expect(m.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("an account without 2FA never passes", async () => {
    m.getActiveTotp.mockResolvedValue(undefined);
    expect(await verifySecondFactor(USER, { code: GOOD_CODE }, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("verifySecondFactor — recovery code", () => {
  const CODE = "ABCD-EFGH-IJKL-MNOP";

  it("a good code passes and hands back a replacement whose hash was stored", async () => {
    m.getActiveTotp.mockResolvedValue(active());
    m.consumeRecoveryCode.mockResolvedValue(true);
    const r = await verifySecondFactor(USER, { recoveryCode: CODE }, NOW);
    expect(r).toMatchObject({ ok: true, usedRecoveryCode: true });
    const replacement = (r as { replacementRecoveryCode: string })
      .replacementRecoveryCode;
    expect(replacement).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    expect(m.consumeRecoveryCode).toHaveBeenCalledWith(
      USER,
      hashRecoveryCode(USER, "ABCDEFGHIJKLMNOP"),
      hashRecoveryCode(USER, replacement.replace(/-/g, "")),
    );
  });

  it("works at 100 failures (the only way back in)", async () => {
    m.getActiveTotp.mockResolvedValue(active({ failedAttempts: 100 }));
    m.consumeRecoveryCode.mockResolvedValue(true);
    expect(
      await verifySecondFactor(USER, { recoveryCode: CODE }, NOW),
    ).toMatchObject({ ok: true });
  });

  it("is refused while locked, without counting", async () => {
    m.getActiveTotp.mockResolvedValue(active({ locked: true }));
    expect(await verifySecondFactor(USER, { recoveryCode: CODE }, NOW)).toEqual(
      { ok: false, reason: "locked" },
    );
    expect(m.consumeRecoveryCode).not.toHaveBeenCalled();
    expect(m.recordMfaFailure).not.toHaveBeenCalled();
  });

  it("an unknown or used code fails and counts once", async () => {
    m.getActiveTotp.mockResolvedValue(active());
    m.consumeRecoveryCode.mockResolvedValue(false);
    expect(await verifySecondFactor(USER, { recoveryCode: CODE }, NOW)).toEqual(
      { ok: false, reason: "invalid" },
    );
    expect(m.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("a malformed code fails and counts once, without a database lookup", async () => {
    m.getActiveTotp.mockResolvedValue(active());
    expect(
      await verifySecondFactor(USER, { recoveryCode: "nope" }, NOW),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(m.consumeRecoveryCode).not.toHaveBeenCalled();
    expect(m.recordMfaFailure).toHaveBeenCalledTimes(1);
  });
});
