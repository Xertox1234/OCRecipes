import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrorCode } from "@shared/constants/error-codes";

const { verifySecondFactor } = vi.hoisted(() => ({
  verifySecondFactor: vi.fn(),
}));
vi.mock("../verify-second-factor", () => ({ verifySecondFactor }));

const { secondFactorForPasswordProof } = await import("../password-proof-gate");

const MFA_USER = {
  id: "u1",
  email: "u@x.com",
  username: "chef",
  mfaEnabledAt: new Date(),
};
const PLAIN_USER = { ...MFA_USER, mfaEnabledAt: null };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("secondFactorForPasswordProof", () => {
  it("a Google/Apple proof on an MFA account passes without a code (D1)", async () => {
    expect(
      await secondFactorForPasswordProof(MFA_USER, false, undefined),
    ).toEqual({ ok: true });
    expect(verifySecondFactor).not.toHaveBeenCalled();
  });

  it("a password proof on an account without MFA passes", async () => {
    expect(
      await secondFactorForPasswordProof(PLAIN_USER, true, undefined),
    ).toEqual({ ok: true });
    expect(verifySecondFactor).not.toHaveBeenCalled();
  });

  it("a password proof on an MFA account with no code → 403 SECOND_FACTOR_REQUIRED", async () => {
    expect(
      await secondFactorForPasswordProof(MFA_USER, true, undefined),
    ).toEqual({
      ok: false,
      status: 403,
      code: ErrorCode.SECOND_FACTOR_REQUIRED,
      message: "Enter your two-step verification code.",
    });
    expect(verifySecondFactor).not.toHaveBeenCalled();
  });

  it("a wrong code → 401 INVALID_SECOND_FACTOR with the generic copy", async () => {
    verifySecondFactor.mockResolvedValue({ ok: false });
    expect(
      await secondFactorForPasswordProof(MFA_USER, true, { code: "000000" }),
    ).toEqual({
      ok: false,
      status: 401,
      code: ErrorCode.INVALID_SECOND_FACTOR,
      message:
        "That code didn't work. After several wrong codes, codes pause for 15 minutes.",
    });
  });

  it("the right code passes", async () => {
    verifySecondFactor.mockResolvedValue({ ok: true });
    expect(
      await secondFactorForPasswordProof(MFA_USER, true, { code: "123456" }),
    ).toEqual({ ok: true });
    expect(verifySecondFactor).toHaveBeenCalledWith(
      { id: "u1", email: "u@x.com", username: "chef" },
      { code: "123456" },
    );
  });
});
