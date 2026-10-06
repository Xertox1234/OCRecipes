import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  formatSetupKey,
  recoveryCodesText,
  getTwoFactorErrorMessage,
} from "../TwoFactorSetupScreen-utils";

describe("TwoFactorSetupScreen-utils", () => {
  it("groups the setup key in fours for reading and typing", () => {
    expect(formatSetupKey("ABCDEFGHIJKLMN")).toBe("ABCD EFGH IJKL MN");
  });

  it("recovery codes copy as one per line under a header", () => {
    expect(
      recoveryCodesText(["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"]),
    ).toBe(
      "OCRecipes recovery codes — each works once\n\nAAAA-BBBB-CCCC-DDDD\nEEEE-FFFF-GGGG-HHHH",
    );
  });

  it.each([
    ["UNAUTHORIZED", 401, "That didn't match. Please try again."],
    [
      "INVALID_PROVIDER_TOKEN",
      401,
      "That sign-in couldn't be confirmed. Please try again.",
    ],
    [
      "MFA_CODE_INVALID",
      401,
      "That code didn't work. Check your authenticator app and try again.",
    ],
    ["MFA_LOCKED", 429, "Too many wrong codes. Try again in 15 minutes."],
    [
      "MFA_UNAVAILABLE",
      503,
      "Two-step verification isn't available right now. Please try again later.",
    ],
    ["MFA_ALREADY_ENABLED", 409, "Two-step verification is already on."],
    ["MFA_NOT_ENABLED", 409, "Two-step verification is already off."],
    [
      "RATE_LIMITED",
      429,
      "Too many attempts. Please wait a few minutes and try again.",
    ],
  ])("%s → %j", (code, status, message) => {
    expect(getTwoFactorErrorMessage(new ApiError("raw", code, status))).toBe(
      message,
    );
  });

  it("anything else gets the generic copy, never the raw message", () => {
    expect(getTwoFactorErrorMessage(new Error("<raw>"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
