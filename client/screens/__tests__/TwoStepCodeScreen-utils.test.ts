import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  afterVerify,
  afterVerifyFailure,
  showTrustSwitch,
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
