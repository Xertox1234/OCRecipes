import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { base32Encode, hotp, timeStep } from "../totp";
import { hashRecoveryCode, normalizeRecoveryCode } from "../mfa-secrets";
import { hashSignInCode } from "../../password-reset-code";

const { storage, sendTwoFactorNotice, decrypt } = vi.hoisted(() => ({
  storage: {
    getActiveTotp: vi.fn(),
    acceptTotpStep: vi.fn(),
    recordMfaFailure: vi.fn(),
    consumeRecoveryCode: vi.fn(),
    getMfaState: vi.fn(),
    reserveMfaEmailAttempt: vi.fn(),
    acceptMfaEmailCode: vi.fn(),
  },
  sendTwoFactorNotice: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("../../../storage", () => ({ storage }));
vi.mock("../../../services/email", () => ({ sendTwoFactorNotice }));
vi.mock("../mfa-secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mfa-secrets")>()),
  decryptMfaSecret: decrypt,
}));

const { verifySecondFactor } = await import("../verify-second-factor");
const { MfaUnavailableError } = await import("../mfa-secrets");

const SECRET = crypto.randomBytes(20);
const SECRET_B32 = base32Encode(SECRET);
const NOW = 1_700_000_000_000;
const STEP = timeStep(NOW);
const USER = { id: "u1", email: "u@x.com", username: "chef" };
const RECOVERY = "ABCD-EFGH-IJKL-MNOP";

function active(
  over: Partial<{ failedAttempts: number; locked: boolean }> = {},
) {
  storage.getActiveTotp.mockResolvedValue({
    secretEnc: "blob",
    failedAttempts: 0,
    locked: false,
    ...over,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  decrypt.mockReturnValue(SECRET_B32);
  storage.acceptTotpStep.mockResolvedValue(true);
  storage.recordMfaFailure.mockResolvedValue({
    failedAttempts: 1,
    tripped: false,
  });
  storage.consumeRecoveryCode.mockResolvedValue(true);
  sendTwoFactorNotice.mockResolvedValue(undefined);
  storage.getMfaState.mockResolvedValue({
    method: "totp",
    failedAttempts: 0,
    locked: false,
  });
  active();
});

describe("verifySecondFactor — authenticator code", () => {
  it("accepts the right code and burns its step; no failure counted", async () => {
    const r = await verifySecondFactor(USER, { code: hotp(SECRET, STEP) }, NOW);
    expect(r).toEqual({ ok: true });
    expect(storage.acceptTotpStep).toHaveBeenCalledWith("u1", STEP);
    expect(storage.recordMfaFailure).not.toHaveBeenCalled();
  });

  it("a right code whose step was already used (replay) is a failure", async () => {
    storage.acceptTotpStep.mockResolvedValue(false);
    const r = await verifySecondFactor(USER, { code: hotp(SECRET, STEP) }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("a wrong code counts one failure; the tripping one sends the locked notice once", async () => {
    storage.recordMfaFailure.mockResolvedValue({
      failedAttempts: 10,
      tripped: true,
    });
    const wrong = hotp(SECRET, STEP + 5);
    const r = await verifySecondFactor(USER, { code: wrong }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
    expect(sendTwoFactorNotice).toHaveBeenCalledTimes(1);
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "u@x.com",
      "chef",
      "locked",
    );
  });

  it("a wrong code that does not trip sends no notice", async () => {
    await verifySecondFactor(USER, { code: hotp(SECRET, STEP + 5) }, NOW);
    expect(sendTwoFactorNotice).not.toHaveBeenCalled();
  });

  it("while locked, even the right code is refused without counting", async () => {
    active({ locked: true });
    const r = await verifySecondFactor(USER, { code: hotp(SECRET, STEP) }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.acceptTotpStep).not.toHaveBeenCalled();
    expect(storage.recordMfaFailure).not.toHaveBeenCalled();
  });

  it("at 100 consecutive failures the right code is refused (recovery code only)", async () => {
    active({ failedAttempts: 100 });
    const r = await verifySecondFactor(USER, { code: hotp(SECRET, STEP) }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.acceptTotpStep).not.toHaveBeenCalled();
  });

  it("at 99 failures the right code still works", async () => {
    active({ failedAttempts: 99 });
    const r = await verifySecondFactor(USER, { code: hotp(SECRET, STEP) }, NOW);
    expect(r).toEqual({ ok: true });
  });

  it.each([
    ["the key is missing", () => new MfaUnavailableError()],
    ["the key was rotated (GCM auth fails)", () => new Error("bad auth tag")],
  ])("answers unavailable when %s, counting nothing", async (_, err) => {
    decrypt.mockImplementation(() => {
      throw err();
    });
    const r = await verifySecondFactor(USER, { code: hotp(SECRET, STEP) }, NOW);
    expect(r).toEqual({ ok: false, reason: "unavailable" });
    expect(storage.recordMfaFailure).not.toHaveBeenCalled();
    expect(storage.acceptTotpStep).not.toHaveBeenCalled();
  });

  it("no active authenticator → invalid", async () => {
    storage.getActiveTotp.mockResolvedValue(undefined);
    const r = await verifySecondFactor(USER, { code: "123456" }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("verifySecondFactor — recovery code", () => {
  it("a good code passes, returns a replacement, and sends the used notice", async () => {
    const r = await verifySecondFactor(USER, { recoveryCode: RECOVERY }, NOW);
    expect(r.ok).toBe(true);
    const replacement = (r as { replacementRecoveryCode: string })
      .replacementRecoveryCode;
    expect(replacement).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    expect(storage.consumeRecoveryCode).toHaveBeenCalledWith(
      "u1",
      hashRecoveryCode("u1", "ABCDEFGHIJKLMNOP"),
      hashRecoveryCode("u1", normalizeRecoveryCode(replacement)!),
    );
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "u@x.com",
      "chef",
      "recovery_code_used",
    );
  });

  it("works past the 100-failure cap", async () => {
    active({ failedAttempts: 100 });
    const r = await verifySecondFactor(USER, { recoveryCode: RECOVERY }, NOW);
    expect(r.ok).toBe(true);
  });

  it("an unknown code counts one failure", async () => {
    storage.consumeRecoveryCode.mockResolvedValue(false);
    const r = await verifySecondFactor(USER, { recoveryCode: RECOVERY }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("a malformed code counts one failure without touching storage", async () => {
    const r = await verifySecondFactor(USER, { recoveryCode: "nope" }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.consumeRecoveryCode).not.toHaveBeenCalled();
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("while locked, a good code is refused without counting", async () => {
    active({ locked: true });
    const r = await verifySecondFactor(USER, { recoveryCode: RECOVERY }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.consumeRecoveryCode).not.toHaveBeenCalled();
    expect(storage.recordMfaFailure).not.toHaveBeenCalled();
  });
});

describe("verifySecondFactor — emailed code", () => {
  const CODE = "482913";
  beforeEach(() => {
    storage.getMfaState.mockResolvedValue({
      method: "email",
      failedAttempts: 0,
      locked: false,
    });
    storage.reserveMfaEmailAttempt.mockResolvedValue(
      hashSignInCode("u1", CODE),
    );
    storage.acceptMfaEmailCode.mockResolvedValue(true);
  });

  it("the right code passes and is spent; no authenticator key is touched", async () => {
    const r = await verifySecondFactor(USER, { code: CODE }, NOW);
    expect(r).toEqual({ ok: true });
    expect(storage.acceptMfaEmailCode).toHaveBeenCalledWith(
      "u1",
      hashSignInCode("u1", CODE),
    );
    expect(storage.getActiveTotp).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
    expect(storage.recordMfaFailure).not.toHaveBeenCalled();
  });

  it("a wrong code counts one failure and spends nothing", async () => {
    const r = await verifySecondFactor(USER, { code: "000000" }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
    expect(storage.acceptMfaEmailCode).not.toHaveBeenCalled();
  });

  it("no live code (expired, used up, or never sent) counts one failure", async () => {
    storage.reserveMfaEmailAttempt.mockResolvedValue(undefined);
    const r = await verifySecondFactor(USER, { code: CODE }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("a code spent by a racing request is a failure", async () => {
    storage.acceptMfaEmailCode.mockResolvedValue(false);
    const r = await verifySecondFactor(USER, { code: CODE }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("while locked, the right code is refused without counting or spending a guess", async () => {
    storage.getMfaState.mockResolvedValue({
      method: "email",
      failedAttempts: 10,
      locked: true,
    });
    const r = await verifySecondFactor(USER, { code: CODE }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.reserveMfaEmailAttempt).not.toHaveBeenCalled();
    expect(storage.recordMfaFailure).not.toHaveBeenCalled();
  });

  // No recovery codes exist for email accounts, so there is no hard cap:
  // the every-10th lock and the per-code / per-day limits bound guessing.
  it("past 100 failures the right code still works", async () => {
    storage.getMfaState.mockResolvedValue({
      method: "email",
      failedAttempts: 150,
      locked: false,
    });
    expect(await verifySecondFactor(USER, { code: CODE }, NOW)).toEqual({
      ok: true,
    });
  });

  it("a recovery code is refused and counted", async () => {
    const r = await verifySecondFactor(USER, { recoveryCode: RECOVERY }, NOW);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(storage.consumeRecoveryCode).not.toHaveBeenCalled();
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
  });
});
