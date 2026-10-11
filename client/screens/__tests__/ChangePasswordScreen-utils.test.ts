import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  forgotOptions,
  changePasswordErrorMessage,
  codeRequestErrorMessage,
} from "../ChangePasswordScreen-utils";

const apiErr = (status: number, body: { error: string; code?: string }) =>
  new ApiError(`${status}: ${JSON.stringify(body)}`, body.code, status);

describe("forgotOptions", () => {
  it("lists only connected providers, Google before Apple, then the email code", () => {
    expect(forgotOptions(["apple", "google"])).toEqual([
      { kind: "provider", provider: "google", label: "Confirm with Google" },
      { kind: "provider", provider: "apple", label: "Confirm with Apple" },
      { kind: "email", label: "Email me a code" },
    ]);
  });
  it("no providers → only the email code", () => {
    expect(forgotOptions([])).toEqual([
      { kind: "email", label: "Email me a code" },
    ]);
  });
});

describe("changePasswordErrorMessage", () => {
  it.each([
    [
      apiErr(401, { error: "x", code: "UNAUTHORIZED" }),
      "That didn't match. Try again.",
    ],
    [
      apiErr(400, { error: "x", code: "INVALID_RESET_CODE" }),
      "That code didn't work. Request a new one.",
    ],
    [
      apiErr(401, { error: "x", code: "TOKEN_REVOKED" }),
      "Please sign in again.",
    ],
    [
      apiErr(429, { error: "x", code: "RATE_LIMITED" }),
      "Too many attempts. Please try again later.",
    ],
    [
      apiErr(400, {
        error: "Use at least 15 characters.",
        code: "PASSWORD_TOO_SHORT",
      }),
      "Use at least 15 characters.",
    ],
    [
      apiErr(400, {
        error:
          "That password has appeared in a data breach. Choose a different one.",
        code: "PASSWORD_BREACHED",
      }),
      "That password has appeared in a data breach. Choose a different one.",
    ],
    [new Error("network"), "Something went wrong. Please try again."],
  ])("%#", (err, message) => {
    expect(changePasswordErrorMessage(err)).toBe(message);
  });
});

describe("codeRequestErrorMessage", () => {
  // Review: two different 429s. The daily cap says "tomorrow"; the hourly
  // burst limiter must not — show whichever the server sent.
  it("the daily cap's 429 shows its own message", () => {
    const daily =
      "You've requested too many codes today. Try again tomorrow, or use Google/Apple.";
    expect(
      codeRequestErrorMessage(
        apiErr(429, { error: daily, code: "RATE_LIMITED" }),
      ),
    ).toBe(daily);
  });
  it("the hourly limiter's 429 shows its own message, never 'tomorrow'", () => {
    expect(
      codeRequestErrorMessage(
        apiErr(429, {
          error: "Too many code requests. Please wait.",
          code: "RATE_LIMITED",
        }),
      ),
    ).toBe("Too many code requests. Please wait.");
  });
  it("a 429 with no readable body → a time-neutral message", () => {
    expect(
      codeRequestErrorMessage(
        new ApiError("429: not json", "RATE_LIMITED", 429),
      ),
    ).toBe("Too many code requests. Please wait a while and try again.");
  });
  it("anything else → the generic message", () => {
    expect(codeRequestErrorMessage(new Error("x"))).toBe(
      "Couldn't send the code. Please try again.",
    );
  });
});
