import { describe, it, expect } from "vitest";
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
  it("D1: a Google/Apple sign-in on an MFA account goes straight in", () => {
    expect(
      gates.signInGate(
        { ...user, mfaEnabledAt: new Date() },
        { emailWillBeVerified: false, verificationOn: true },
      ),
    ).toEqual({ ok: true });
  });
});

describe("secondFactor.requiresSecondFactor", () => {
  it("is true exactly when two-step verification is on", () => {
    expect(
      gates.secondFactor.requiresSecondFactor({ mfaEnabledAt: new Date() }),
    ).toBe(true);
    expect(
      gates.secondFactor.requiresSecondFactor({ mfaEnabledAt: null }),
    ).toBe(false);
  });
});
