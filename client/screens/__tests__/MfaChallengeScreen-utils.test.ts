import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  normalizeCodeInput,
  getMfaErrorMessage,
  isCompleteCode,
} from "../MfaChallengeScreen-utils";

describe("MfaChallengeScreen-utils", () => {
  it("keeps digits only, capped at 6 (autofill or paste may add spaces)", () => {
    expect(normalizeCodeInput("123 456")).toBe("123456");
    expect(normalizeCodeInput("12-34-567")).toBe("123456");
    expect(normalizeCodeInput("abc")).toBe("");
  });

  it("a code is complete at exactly 6 digits", () => {
    expect(isCompleteCode("12345")).toBe(false);
    expect(isCompleteCode("123456")).toBe(true);
  });

  it.each([
    [
      new ApiError("x", "MFA_CHALLENGE_INVALID", 401),
      "code",
      "This sign-in expired. Please sign in again.",
      true,
    ],
    [
      new ApiError("x", "MFA_LOCKED", 429),
      "code",
      "Too many wrong codes. Try again in 15 minutes.",
      false,
    ],
    [
      new ApiError("x", "MFA_CODE_INVALID", 401),
      "code",
      "That code didn't work. Check your authenticator app and try again.",
      false,
    ],
    [
      new ApiError("x", "MFA_CODE_INVALID", 401),
      "recovery",
      "That recovery code didn't work. Check it and try again.",
      false,
    ],
    [
      new ApiError("x", "RATE_LIMITED", 429),
      "code",
      "Too many attempts. Please wait a few minutes and try again.",
      false,
    ],
    [
      new Error("network"),
      "code",
      "Couldn't check that code. Please try again.",
      false,
    ],
  ] as const)("%o (%s) → %j, restart=%s", (err, mode, message, restart) => {
    expect(getMfaErrorMessage(err, mode)).toEqual({ message, restart });
  });

  it("never echoes the server's own message text", () => {
    const err = new ApiError("<script>raw</script>", "MFA_CODE_INVALID", 401);
    expect(getMfaErrorMessage(err, "code").message).not.toContain("script");
  });
});
