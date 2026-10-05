import { describe, it, expect } from "vitest";
import {
  connectPromptMode,
  connectErrorOutcome,
  chooseUsernameErrorOutcome,
} from "../ConnectAccountScreen-utils";
import { ApiError } from "@/lib/api-error";

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

describe("connectErrorOutcome", () => {
  it.each([
    ["UNAUTHORIZED", 401, /incorrect password/i],
    ["SECOND_FACTOR_REQUIRED", 403, /two-step/i],
    ["RATE_LIMITED", 429, /too many/i],
  ])("%s → inline copy", (code, status, re) => {
    const out = connectErrorOutcome(
      new ApiError("raw", code, status),
      "password",
    );
    expect(out.kind).toBe("inline");
    expect(out.kind === "inline" && out.message).toMatch(re);
  });
  it.each([
    ["password", "INVALID_PROVIDER_TOKEN"],
    ["provider", "INVALID_PROVIDER_TOKEN"],
    // Provider mode: the Apple ID isn't the one linked to this account.
    ["provider", "UNAUTHORIZED"],
  ] as const)("%s mode, %s → couldn't-confirm copy", (mode, code) => {
    const out = connectErrorOutcome(new ApiError("raw", code, 401), mode);
    expect(out).toEqual({
      kind: "inline",
      message: expect.stringMatching(/couldn't be confirmed/i),
    });
    expect(out.message).not.toMatch(/password/i);
  });
  it("a used-up ticket restarts sign-in without blaming the clock", () => {
    // INVALID_SIGN_IN_TICKET covers both expiry and 5 wrong passwords.
    const out = connectErrorOutcome(
      new ApiError("raw", "INVALID_SIGN_IN_TICKET", 400),
      "password",
    );
    expect(out).toEqual({
      kind: "restart",
      message: expect.stringMatching(/start again/i),
    });
    expect(out.message).not.toMatch(/too long/i);
  });
  it("never shows the server message", () => {
    const out = connectErrorOutcome(
      new ApiError("secret", "X", 500),
      "password",
    );
    expect(out.kind === "inline" && out.message).not.toContain("secret");
  });
});

describe("chooseUsernameErrorOutcome", () => {
  it("409 → the username is taken", () => {
    const out = chooseUsernameErrorOutcome(
      new ApiError("raw", "CONFLICT", 409),
    );
    expect(out.kind === "inline" && out.message).toMatch(/taken/i);
  });
  it("an expired ticket restarts sign-in", () => {
    expect(
      chooseUsernameErrorOutcome(
        new ApiError("raw", "INVALID_SIGN_IN_TICKET", 400),
      ),
    ).toEqual({ kind: "restart", message: expect.stringMatching(/too long/i) });
  });
  it("EMAIL_IN_USE → restart so the next sign-in offers to connect", () => {
    const out = chooseUsernameErrorOutcome(
      new ApiError("raw", "EMAIL_IN_USE", 409),
    );
    expect(out.kind).toBe("restart");
    expect(out.kind === "restart" && out.message).toMatch(/already exists/i);
    expect(out.kind === "restart" && out.message).not.toMatch(/username/i);
  });
  it("anything else → generic copy", () => {
    const out = chooseUsernameErrorOutcome(new Error("x"));
    expect(out.kind === "inline" && out.message).toMatch(/try again/i);
  });
});
