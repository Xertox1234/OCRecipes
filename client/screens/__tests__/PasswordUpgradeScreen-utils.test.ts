import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  closesTwoStep,
  isPassExpired,
  showTwoStepChoice,
  upgradeMessageFor,
} from "../PasswordUpgradeScreen-utils";

describe("showTwoStepChoice", () => {
  it("only when the pass allows two-step and setup isn't closed", () => {
    expect(showTwoStepChoice(true, false)).toBe(true);
    expect(showTwoStepChoice(false, false)).toBe(false);
    expect(showTwoStepChoice(true, true)).toBe(false);
    expect(showTwoStepChoice(false, true)).toBe(false);
  });
});

describe("upgradeMessageFor — static copy per code, never the raw message", () => {
  it.each([
    ["UPGRADE_PASS_EXPIRED", "This sign-in expired. Please sign in again."],
    ["PASSWORD_TOO_SHORT", "Use at least 15 characters."],
    [
      "PASSWORD_BREACHED",
      "That password has appeared in a data breach. Choose a different one.",
    ],
    [
      "MFA_SETUP_DISABLED",
      "Two-step verification isn't available right now. Choose a longer password instead.",
    ],
    [
      "UPGRADE_TWO_STEP_NOT_ALLOWED",
      "Two-step verification isn't available right now. Choose a longer password instead.",
    ],
    [
      "MFA_UNAVAILABLE",
      "Two-step verification isn't available right now. Choose a longer password instead.",
    ],
    [
      "RATE_LIMITED",
      "Too many attempts. Please wait a few minutes and try again.",
    ],
  ])("%s → %s", (code, message) => {
    expect(upgradeMessageFor(new ApiError("400: raw body", code, 400))).toBe(
      message,
    );
  });

  it("a request that never reached the server says so", () => {
    expect(upgradeMessageFor(new TypeError("Network request failed"))).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
  });

  it("anything else gets the generic sentence", () => {
    expect(upgradeMessageFor(new Error("raw body"))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(
      upgradeMessageFor(new ApiError("500: raw body", "INTERNAL_ERROR", 500)),
    ).toBe("Something went wrong. Please try again.");
  });
});

describe("isPassExpired / closesTwoStep", () => {
  it("recognise their codes only", () => {
    expect(isPassExpired(new ApiError("x", "UPGRADE_PASS_EXPIRED", 401))).toBe(
      true,
    );
    expect(isPassExpired(new ApiError("x", "PASSWORD_TOO_SHORT", 400))).toBe(
      false,
    );
    expect(isPassExpired(new Error("x"))).toBe(false);
    for (const code of [
      "MFA_SETUP_DISABLED",
      "UPGRADE_TWO_STEP_NOT_ALLOWED",
      "MFA_UNAVAILABLE",
    ]) {
      expect(closesTwoStep(new ApiError("x", code, 403))).toBe(true);
    }
    expect(closesTwoStep(new ApiError("x", "INVALID_SECOND_FACTOR", 400))).toBe(
      false,
    );
  });
});
