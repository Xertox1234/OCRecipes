import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  normalizeResetCode,
  validateResetForm,
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
  it("requires a 6-digit code before the password rules", () => {
    expect(
      validateResetForm({
        code: "123",
        password: "abcdefg1",
        confirmPassword: "abcdefg1",
      }),
    ).toBe("Enter the 6-digit code from the email");
    expect(
      validateResetForm({
        code: "123456",
        password: "short1",
        confirmPassword: "short1",
      }),
    ).toBe("Password must be at least 8 characters");
    expect(
      validateResetForm({
        code: "123456",
        password: "abcdefg1",
        confirmPassword: "abcdefg1",
      }),
    ).toBeNull();
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
