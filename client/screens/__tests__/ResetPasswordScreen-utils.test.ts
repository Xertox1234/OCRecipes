import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  normalizeResetCode,
  resetCodeError,
  resetPasswordError,
  resetConfirmError,
  getResetErrorMessage,
  resendSecondsRemaining,
  INVALID_RESET_CODE_MESSAGE,
} from "../ResetPasswordScreen-utils";

describe("ResetPasswordScreen-utils", () => {
  it("strips spaces/dashes from pasted or autofilled codes and caps at 6", () => {
    expect(normalizeResetCode("123 456")).toBe("123456");
    expect(normalizeResetCode("123-456")).toBe("123456");
    expect(normalizeResetCode(" 1234567 ")).toBe("123456");
  });
  it("maps the server's password-policy codes to plain sentences", () => {
    expect(
      getResetErrorMessage(new ApiError("x", "PASSWORD_TOO_SHORT", 400)),
    ).toBe("Use at least 8 characters.");
    expect(
      getResetErrorMessage(new ApiError("x", "PASSWORD_BREACHED", 400)),
    ).toBe(
      "That password has appeared in a data breach. Choose a different one.",
    );
  });
  it("maps INVALID_RESET_CODE to the uniform message", () => {
    expect(
      getResetErrorMessage(new ApiError("x", "INVALID_RESET_CODE", 400)),
    ).toBe(INVALID_RESET_CODE_MESSAGE);
    expect(INVALID_RESET_CODE_MESSAGE).toBe(
      "That code is incorrect or expired. After 5 wrong tries, request a new code.",
    );
  });
  it("maps 429 and other errors to static copy", () => {
    expect(getResetErrorMessage(new ApiError("x", "RATE_LIMITED", 429))).toBe(
      "Too many attempts. Please wait a few minutes and try again.",
    );
    expect(getResetErrorMessage(new Error("boom"))).toBe(
      "Couldn't reset your password right now. Please try again shortly.",
    );
  });
  it("counts the resend cooldown down from 60 s and never below 0", () => {
    expect(resendSecondsRemaining(1_000, 1_000)).toBe(60);
    expect(resendSecondsRemaining(1_000, 31_500)).toBe(30);
    expect(resendSecondsRemaining(1_000, 61_000)).toBe(0);
    expect(resendSecondsRemaining(1_000, 999_999)).toBe(0);
  });
});

// Each field's own message, for the per-field validation timing (§5.1).
describe("reset field messages", () => {
  it("names each empty field", () => {
    expect(resetCodeError("")).toBe("Enter the 6-digit code from the email");
    expect(resetPasswordError("")).toBe("Enter a new password.");
    expect(resetConfirmError("", "")).toBeNull();
  });
  it("needs all 6 digits of the code", () => {
    expect(resetCodeError("123")).toBe("Enter the 6-digit code from the email");
    expect(resetCodeError("123456")).toBeNull();
  });
  it("accepts 8 characters with no composition rule (8 for everyone)", () => {
    expect(resetPasswordError("abcdefgh")).toBeNull();
    expect(resetPasswordError("short1")).toBe("Use at least 8 characters.");
  });
  it("flags a mismatch on the confirm field", () => {
    expect(resetConfirmError("short2", "short1")).toBe(
      "Passwords do not match",
    );
  });
  it("asks for the confirmation when it is empty", () => {
    expect(resetConfirmError("", "abcdefgh")).toBe(
      "Re-enter the new password.",
    );
  });
});
