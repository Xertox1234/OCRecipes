import { describe, it, expect } from "vitest";
import {
  visibleProviders,
  canDisconnect,
  socialSignInErrorMessage,
  connectPromptMode,
  toMethodList,
  deleteProofMode,
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

const both = { apple: true, google: true };
const appleOnlyBuild = { apple: true, google: false };

describe("connectPromptMode", () => {
  it("password when the account has one", () => {
    expect(connectPromptMode(["password", "apple"], "ios", both)).toEqual({
      kind: "password",
    });
  });
  it("the linked provider for a provider-only account", () => {
    expect(connectPromptMode(["apple"], "ios", both)).toEqual({
      kind: "provider",
      provider: "apple",
    });
  });
  it("Apple-only account on Android can only reset", () => {
    expect(connectPromptMode(["apple"], "android", both)).toEqual({
      kind: "reset_only",
    });
  });
  it("Google-only account in a build without the Google SDK can only reset", () => {
    expect(connectPromptMode(["google"], "ios", appleOnlyBuild)).toEqual({
      kind: "reset_only",
    });
  });
});

const APPLE_ONLY = { apple: true, google: false } as const;
const relay = { email: "x@privaterelay.appleid.com", isPrivateRelay: true };

describe("toMethodList", () => {
  it("lists what is set up, password first", () => {
    expect(
      toMethodList({ password: true, google: null, apple: relay }),
    ).toEqual(["password", "apple"]);
  });
});

describe("deleteProofMode", () => {
  it("loading until the methods arrive", () => {
    expect(deleteProofMode(undefined, "ios", APPLE_ONLY)).toEqual({
      kind: "loading",
    });
  });
  it("password when one is set", () => {
    expect(
      deleteProofMode(
        { password: true, google: null, apple: relay },
        "ios",
        APPLE_ONLY,
      ),
    ).toEqual({ kind: "password" });
  });
  it("Apple when it is the only way in", () => {
    expect(
      deleteProofMode(
        { password: false, google: null, apple: relay },
        "ios",
        APPLE_ONLY,
      ),
    ).toEqual({ kind: "provider", provider: "apple" });
  });
});
