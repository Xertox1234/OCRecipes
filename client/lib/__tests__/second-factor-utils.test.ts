import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  normalizeCodeInput,
  isSecondFactorRequired,
  secondFactorErrorMessage,
  isTwoStepCheckError,
  emailCodeButtonLabel,
  emailCodeSendError,
  twoStepCodeParams,
} from "../second-factor-utils";

/** The shape throwIfResNotOk produces: `${status}: ${body}`. */
function apiError(status: number, body: Record<string, unknown>) {
  return new ApiError(
    `${status}: ${JSON.stringify(body)}`,
    body.code as string | undefined,
    status,
  );
}

describe("normalizeCodeInput", () => {
  it.each([
    ["123456", "123456"],
    ["123 456", "123456"],
    ["12-34-56", "123456"],
    ["1234567", "123456"],
    ["abc", ""],
  ])("%j → %j", (raw, out) => {
    expect(normalizeCodeInput(raw)).toBe(out);
  });
});

describe("isSecondFactorRequired", () => {
  it("is true only for SECOND_FACTOR_REQUIRED", () => {
    expect(
      isSecondFactorRequired(
        apiError(403, { code: "SECOND_FACTOR_REQUIRED", error: "x" }),
      ),
    ).toBe(true);
    expect(
      isSecondFactorRequired(apiError(401, { code: "UNAUTHORIZED" })),
    ).toBe(false);
    expect(isSecondFactorRequired(new Error("x"))).toBe(false);
  });
});

describe("secondFactorErrorMessage", () => {
  it("an expired challenge restarts the sign-in", () => {
    expect(
      secondFactorErrorMessage(
        apiError(401, { code: "MFA_CHALLENGE_EXPIRED" }),
      ),
    ).toEqual({
      message: "This sign-in expired. Please start again.",
      restart: true,
    });
  });
  it("a wrong code shows the server's message", () => {
    expect(
      secondFactorErrorMessage(
        apiError(401, {
          code: "INVALID_SECOND_FACTOR",
          error:
            "That code didn't work. After several wrong codes, codes pause for 15 minutes.",
        }),
      ),
    ).toEqual({
      message:
        "That code didn't work. After several wrong codes, codes pause for 15 minutes.",
      restart: false,
    });
  });
  it("unavailable, rate limited and unknown errors have fixed copy", () => {
    expect(
      secondFactorErrorMessage(apiError(503, { code: "MFA_UNAVAILABLE" }))
        .message,
    ).toBe(
      "Two-step verification is unavailable right now. Please try again later.",
    );
    expect(
      secondFactorErrorMessage(apiError(429, { code: "RATE_LIMITED" })).message,
    ).toBe("Too many attempts. Please wait a few minutes and try again.");
    expect(secondFactorErrorMessage(new Error("network")).message).toBe(
      "Couldn't check that code. Please try again.",
    );
  });
});

describe("isTwoStepCheckError", () => {
  it("matches the answers about the code itself, not other failures", () => {
    for (const code of [
      "INVALID_SECOND_FACTOR",
      "MFA_UNAVAILABLE",
      "RATE_LIMITED",
    ]) {
      expect(isTwoStepCheckError(apiError(401, { code }))).toBe(true);
    }
    expect(isTwoStepCheckError(apiError(401, { code: "UNAUTHORIZED" }))).toBe(
      false,
    );
    expect(isTwoStepCheckError(new Error("x"))).toBe(false);
  });
});

describe("emailCodeButtonLabel", () => {
  it("before any send: Email me a code", () => {
    expect(emailCodeButtonLabel(false, 0)).toBe("Email me a code");
  });
  it("counting down after a send", () => {
    expect(emailCodeButtonLabel(true, 27)).toBe("Resend code in 27s");
  });
  it("after the wait: Resend code", () => {
    expect(emailCodeButtonLabel(true, 0)).toBe("Resend code");
  });
});

describe("emailCodeSendError", () => {
  it("too soon", () => {
    expect(
      emailCodeSendError(apiError(429, { code: "RATE_LIMITED", error: "x" })),
    ).toBe("Wait a moment before asking for another code.");
  });
  it("daily limit points at the newest email", () => {
    expect(
      emailCodeSendError(
        apiError(429, { code: "MFA_EMAIL_DAILY_LIMIT", error: "x" }),
      ),
    ).toBe(
      "Too many codes today. Use the newest one in your email, or try again tomorrow.",
    );
  });
  it("a dead sign-in", () => {
    expect(
      emailCodeSendError(
        apiError(401, { code: "MFA_CHALLENGE_EXPIRED", error: "x" }),
      ),
    ).toBe("This sign-in expired. Please start again.");
  });
  it("anything else: plain retry copy, never the raw response", () => {
    expect(emailCodeSendError(new Error("boom"))).toBe(
      "Couldn't send a code. Please try again.",
    );
  });
});

describe("twoStepCodeParams", () => {
  it("carries the email details through to the code screen", () => {
    expect(
      twoStepCodeParams(
        {
          status: "mfa_required",
          challenge: "c",
          emailHint: "w•••@x.com",
          codeSent: true,
        },
        "link",
      ),
    ).toEqual({
      challenge: "c",
      purpose: "link",
      emailHint: "w•••@x.com",
      codeSent: true,
    });
  });
});
