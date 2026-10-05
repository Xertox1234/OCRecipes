import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  isValidResetEmail,
  getResetRequestErrorMessage,
} from "../ForgotPasswordScreen-utils";

describe("ForgotPasswordScreen-utils", () => {
  it("accepts a trimmed email shape", () => {
    expect(isValidResetEmail("  a@b.co ")).toBe(true);
    expect(isValidResetEmail("nope")).toBe(false);
  });
  it("a 429 gets the honest hourly-limit copy", () => {
    expect(
      getResetRequestErrorMessage(new ApiError("x", "RATE_LIMITED", 429)),
    ).toBe("Too many code requests. Please wait a while and try again.");
  });
  it("a server VALIDATION_ERROR says the email is invalid, not 'try again'", () => {
    expect(
      getResetRequestErrorMessage(new ApiError("x", "VALIDATION_ERROR", 400)),
    ).toBe("Please enter a valid email address.");
  });
  it("anything else gets generic copy (never the raw server message)", () => {
    expect(
      getResetRequestErrorMessage(
        new ApiError("raw server text", "INTERNAL_ERROR", 500),
      ),
    ).toBe("Couldn't send a code right now. Please try again shortly.");
    expect(getResetRequestErrorMessage(new Error("network"))).toBe(
      "Couldn't send a code right now. Please try again shortly.",
    );
  });
});
