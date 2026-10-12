import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  afterVerify,
  afterVerifyFailure,
  showTrustSwitch,
  codeScreenIntro,
  TRUST_LABEL,
} from "../TwoStepCodeScreen-utils";

const user = { id: "u1", username: "chef" };

describe("showTrustSwitch", () => {
  it("only a password sign-in can trust the phone", () => {
    expect(showTrustSwitch("login")).toBe(true);
    expect(showTrustSwitch("link")).toBe(false);
  });
});

describe("afterVerify", () => {
  it("no spent recovery code → finish signing in", () => {
    expect(afterVerify({ status: "signed_in", user, token: "t" })).toEqual({
      kind: "finish",
      user,
      token: "t",
    });
  });
  it("a spent recovery code → show the replacement first", () => {
    expect(
      afterVerify({
        status: "signed_in",
        user,
        token: "t",
        replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
      }),
    ).toEqual({
      kind: "save_code",
      code: "AAAA-BBBB-CCCC-DDDD",
      user,
      token: "t",
    });
  });
});

describe("afterVerifyFailure", () => {
  const err = (status: number, body: object) =>
    new ApiError(
      `${status}: ${JSON.stringify(body)}`,
      (body as { code?: string }).code,
      status,
    );

  it("a wrong code stays on the screen", () => {
    expect(
      afterVerifyFailure(
        err(401, {
          code: "INVALID_SECOND_FACTOR",
          error: "That code didn't work.",
        }),
      ),
    ).toEqual({
      message: "That code didn't work.",
      restart: false,
      replacement: undefined,
    });
  });
  it("an expired sign-in restarts, still handing back a spent code's replacement", () => {
    expect(
      afterVerifyFailure(
        err(401, {
          code: "MFA_CHALLENGE_EXPIRED",
          replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
        }),
      ),
    ).toEqual({
      message: "This sign-in expired. Please start again.",
      restart: true,
      replacement: "AAAA-BBBB-CCCC-DDDD",
    });
  });
});

describe("codeScreenIntro", () => {
  it("email, sent: names the masked address", () => {
    expect(
      codeScreenIntro({
        method: "email",
        emailHint: "w•••@gmail.com",
        codeSent: true,
      }),
    ).toBe(
      "We emailed a 6-digit code to w•••@gmail.com. It can take a minute to arrive.",
    );
  });
  it("email, held back by the limit: use the newest one", () => {
    expect(
      codeScreenIntro({
        method: "email",
        emailHint: "w•••@gmail.com",
        codeSent: false,
      }),
    ).toBe(
      "We've already emailed codes to w•••@gmail.com. Use the newest one, or tap Email me a code.",
    );
  });
  it("authenticator (or an older server that sends no method)", () => {
    expect(codeScreenIntro({ method: "totp" })).toBe(
      "Enter the 6-digit code from your authenticator app.",
    );
    expect(codeScreenIntro({})).toBe(
      "Enter the 6-digit code from your authenticator app.",
    );
  });
  it("the trust switch says what it does, in plain words", () => {
    expect(TRUST_LABEL).toBe("Don't ask again on this phone");
  });
});
