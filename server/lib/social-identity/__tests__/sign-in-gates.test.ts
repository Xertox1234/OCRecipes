import { describe, it, expect, vi } from "vitest";
import * as gates from "../sign-in-gates";

describe("signInGate", () => {
  const user = { id: "u1", emailVerified: true };
  it("passes a verified user with no second factor", () => {
    expect(
      gates.signInGate(user, {
        emailWillBeVerified: false,
        verificationOn: true,
      }),
    ).toEqual({ ok: true });
  });
  it("blocks an unverified user when verification is on", () => {
    expect(
      gates.signInGate(
        { ...user, emailVerified: false },
        { emailWillBeVerified: false, verificationOn: true },
      ),
    ).toMatchObject({ ok: false, status: 403, code: "EMAIL_NOT_VERIFIED" });
  });
  it("lets the link verify the email", () => {
    expect(
      gates.signInGate(
        { ...user, emailVerified: false },
        { emailWillBeVerified: true, verificationOn: true },
      ),
    ).toEqual({ ok: true });
  });
  it("never blocks on the second factor — beginSession challenges instead", () => {
    vi.spyOn(gates.secondFactor, "requiresSecondFactor").mockReturnValue(true);
    expect(
      gates.signInGate(user, {
        emailWillBeVerified: false,
        verificationOn: true,
      }),
    ).toEqual({ ok: true });
    vi.restoreAllMocks();
  });
  it("requiresSecondFactor is true exactly when mfa_enabled_at is set", () => {
    expect(
      gates.secondFactor.requiresSecondFactor({ mfaEnabledAt: null }),
    ).toBe(false);
    expect(
      gates.secondFactor.requiresSecondFactor({ mfaEnabledAt: new Date() }),
    ).toBe(true);
  });
});
