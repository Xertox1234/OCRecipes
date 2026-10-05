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
  it("blocks with SECOND_FACTOR_REQUIRED when the account needs one", () => {
    vi.spyOn(gates.secondFactor, "requiresSecondFactor").mockReturnValue(true);
    expect(
      gates.signInGate(user, {
        emailWillBeVerified: false,
        verificationOn: true,
      }),
    ).toMatchObject({ ok: false, status: 403, code: "SECOND_FACTOR_REQUIRED" });
    vi.restoreAllMocks();
  });
});
