import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  normalizeCodeInput,
  isSecondFactorRequired,
  secondFactorErrorMessage,
  replacementFromError,
  recoveryCodesOrThrow,
  isTwoStepCheckError,
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

describe("replacementFromError", () => {
  it("reads a spent recovery code's replacement off a failed response", () => {
    expect(
      replacementFromError(
        apiError(409, {
          code: "IDENTITY_IN_USE",
          replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
        }),
      ),
    ).toBe("AAAA-BBBB-CCCC-DDDD");
  });
  it("undefined when absent or unreadable", () => {
    expect(replacementFromError(apiError(401, { code: "X" }))).toBeUndefined();
    expect(
      replacementFromError(new ApiError("500: <html>", undefined, 500)),
    ).toBeUndefined();
    expect(replacementFromError(new Error("x"))).toBeUndefined();
  });
});

// Auth audit 2026-10-11 (Phase 6): a refused session mint after two-step was
// turned on still carries the new codes — they are the account's only ones.
describe("recoveryCodesOrThrow", () => {
  it("returns the codes a refused answer carries", () => {
    expect(
      recoveryCodesOrThrow(
        apiError(401, {
          code: "MFA_CHALLENGE_EXPIRED",
          recoveryCodes: ["A", "B"],
        }),
      ),
    ).toEqual(["A", "B"]);
  });
  it("re-throws the same error when there are no codes", () => {
    for (const err of [
      apiError(401, { code: "MFA_CHALLENGE_EXPIRED" }),
      apiError(401, { code: "X", recoveryCodes: "A" }),
      apiError(401, { code: "X", recoveryCodes: [1, 2] }),
      new ApiError("500: <html>", undefined, 500),
      new Error("x"),
    ]) {
      expect(() => recoveryCodesOrThrow(err)).toThrow(err);
    }
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
