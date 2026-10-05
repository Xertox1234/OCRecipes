import { describe, it, expect } from "vitest";
import {
  visibleProviders,
  canDisconnect,
  socialSignInErrorMessage,
} from "../social-auth-utils";
import { ApiError } from "@/lib/api-error";

describe("visibleProviders", () => {
  it("iOS: apple first, google only alongside apple (guideline 4.8)", () => {
    expect(visibleProviders({ google: true, apple: true }, "ios")).toEqual([
      "apple",
      "google",
    ]);
    expect(visibleProviders({ google: true, apple: false }, "ios")).toEqual([]);
    expect(visibleProviders({ google: false, apple: true }, "ios")).toEqual([
      "apple",
    ]);
  });
  it("Android: google only, never apple", () => {
    expect(visibleProviders({ google: true, apple: true }, "android")).toEqual([
      "google",
    ]);
  });
  it("web: none", () => {
    expect(visibleProviders({ google: true, apple: true }, "web")).toEqual([]);
  });
});

describe("canDisconnect", () => {
  it("false for the only method", () => {
    expect(
      canDisconnect(
        {
          password: false,
          google: null,
          apple: { email: null, isPrivateRelay: true },
        },
        "apple",
      ),
    ).toBe(false);
  });
  it("true when a password remains", () => {
    expect(
      canDisconnect(
        { password: true, google: { email: "a@gmail.com" }, apple: null },
        "google",
      ),
    ).toBe(true);
  });
  it("true when another provider remains", () => {
    expect(
      canDisconnect(
        {
          password: false,
          google: { email: "a@gmail.com" },
          apple: { email: null, isPrivateRelay: true },
        },
        "apple",
      ),
    ).toBe(true);
  });
});

describe("socialSignInErrorMessage", () => {
  it.each([
    ["PROVIDER_EXCHANGE_FAILED", /couldn.t finish/i],
    ["PROVIDER_EMAIL_REQUIRED", /email/i],
    ["EMAIL_NOT_VERIFIED", /verify your email/i],
    ["SECOND_FACTOR_REQUIRED", /two-step/i],
    ["RATE_LIMITED", /too many/i],
  ])("%s → specific static copy", (code, re) => {
    expect(socialSignInErrorMessage(new ApiError("raw", code))).toMatch(re);
  });

  it("never echoes the server message", () => {
    expect(
      socialSignInErrorMessage(new ApiError("secret detail", "WHATEVER")),
    ).not.toContain("secret detail");
  });

  it("falls back to generic copy for unknown errors", () => {
    expect(socialSignInErrorMessage(new Error("x"))).toMatch(/try again/i);
  });
});
