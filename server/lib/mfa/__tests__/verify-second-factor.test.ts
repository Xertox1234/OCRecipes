import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashSignInCode } from "../../password-reset-code";

// Two-step is an emailed code only (owner ruling 4, 2026-10-12; authenticator
// apps and recovery codes removed).

const { storage, sendTwoFactorNotice } = vi.hoisted(() => ({
  storage: {
    recordMfaFailure: vi.fn(),
    getMfaState: vi.fn(),
    reserveMfaEmailAttempt: vi.fn(),
    acceptMfaEmailCode: vi.fn(),
  },
  sendTwoFactorNotice: vi.fn(),
}));

vi.mock("../../../storage", () => ({ storage }));
vi.mock("../../../services/email", () => ({ sendTwoFactorNotice }));

const { verifySecondFactor } = await import("../verify-second-factor");

const USER = { id: "u1", email: "u@x.com", username: "chef" };
const CODE = "482913";

beforeEach(() => {
  vi.resetAllMocks();
  storage.recordMfaFailure.mockResolvedValue({
    failedAttempts: 1,
    tripped: false,
  });
  sendTwoFactorNotice.mockResolvedValue(undefined);
  storage.getMfaState.mockResolvedValue({ failedAttempts: 0, locked: false });
  storage.reserveMfaEmailAttempt.mockResolvedValue(hashSignInCode("u1", CODE));
  storage.acceptMfaEmailCode.mockResolvedValue(true);
});

describe("verifySecondFactor — emailed code", () => {
  it("the right code passes and is spent", async () => {
    const r = await verifySecondFactor(USER, { code: CODE });
    expect(r).toEqual({ ok: true });
    expect(storage.acceptMfaEmailCode).toHaveBeenCalledWith(
      "u1",
      hashSignInCode("u1", CODE),
    );
    expect(storage.recordMfaFailure).not.toHaveBeenCalled();
  });

  it("a wrong code counts one failure and spends nothing", async () => {
    const r = await verifySecondFactor(USER, { code: "000000" });
    expect(r).toEqual({ ok: false });
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
    expect(storage.acceptMfaEmailCode).not.toHaveBeenCalled();
  });

  it("the failure that starts a lock emails the owner once", async () => {
    storage.recordMfaFailure.mockResolvedValue({
      failedAttempts: 10,
      tripped: true,
    });
    await verifySecondFactor(USER, { code: "000000" });
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "u@x.com",
      "chef",
      "locked",
    );
  });

  it("no live code (expired, used up, or never sent) counts one failure", async () => {
    storage.reserveMfaEmailAttempt.mockResolvedValue(undefined);
    const r = await verifySecondFactor(USER, { code: CODE });
    expect(r).toEqual({ ok: false });
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("a code spent by a racing request is a failure", async () => {
    storage.acceptMfaEmailCode.mockResolvedValue(false);
    const r = await verifySecondFactor(USER, { code: CODE });
    expect(r).toEqual({ ok: false });
    expect(storage.recordMfaFailure).toHaveBeenCalledTimes(1);
  });

  it("while locked, the right code is refused without counting or spending a guess", async () => {
    storage.getMfaState.mockResolvedValue({ failedAttempts: 10, locked: true });
    const r = await verifySecondFactor(USER, { code: CODE });
    expect(r).toEqual({ ok: false });
    expect(storage.reserveMfaEmailAttempt).not.toHaveBeenCalled();
    expect(storage.recordMfaFailure).not.toHaveBeenCalled();
  });

  it("an account with no two-step row is refused, never thrown", async () => {
    storage.getMfaState.mockResolvedValue(undefined);
    const r = await verifySecondFactor(USER, { code: CODE });
    expect(r).toEqual({ ok: false });
    expect(storage.reserveMfaEmailAttempt).not.toHaveBeenCalled();
  });

  // There is no hard cap: the every-10th lock and the per-code / per-day
  // limits bound guessing.
  it("past 100 failures the right code still works", async () => {
    storage.getMfaState.mockResolvedValue({
      failedAttempts: 150,
      locked: false,
    });
    expect(await verifySecondFactor(USER, { code: CODE })).toEqual({
      ok: true,
    });
  });
});
