import { describe, it, expect } from "vitest";
import type { SignInMethods } from "@shared/types/auth";
import { ApiError } from "@/lib/api-error";
import {
  methodSubtitle,
  toMethodList,
  providerRowState,
  identityErrorMessage,
  deleteProofMode,
} from "../SignInMethodsScreen-utils";

const APPLE_ONLY = { apple: true, google: false } as const;
const relay = { email: "x@privaterelay.appleid.com", isPrivateRelay: true };

describe("methodSubtitle", () => {
  it("hides relay addresses", () => {
    expect(methodSubtitle(relay)).toBe("Hidden by Apple");
  });
  it("shows the email otherwise", () => {
    expect(methodSubtitle({ email: "a@gmail.com" })).toBe("a@gmail.com");
  });
  it("connected without an email", () => {
    expect(methodSubtitle({ email: null })).toBe("Connected");
  });
  it("not connected", () => {
    expect(methodSubtitle(null)).toBe("Not connected");
  });
});

describe("toMethodList", () => {
  it("lists what is set up, password first", () => {
    expect(
      toMethodList({ password: true, google: null, apple: relay }),
    ).toEqual(["password", "apple"]);
  });
});

describe("providerRowState", () => {
  const pw: SignInMethods = { password: true, google: null, apple: null };
  it("connect when a password can confirm it", () => {
    expect(providerRowState(pw, "apple", "ios", APPLE_ONLY)).toEqual({
      kind: "connect",
    });
  });
  it("no password → connect is blocked with a hint", () => {
    const m: SignInMethods = {
      password: false,
      google: { email: "a@gmail.com" },
      apple: null,
    };
    const s = providerRowState(m, "apple", "ios", APPLE_ONLY);
    expect(s.kind).toBe("connect_blocked");
    expect(s.kind === "connect_blocked" && s.hint).toMatch(/password/i);
  });
  it("the only sign-in method cannot be disconnected", () => {
    const m: SignInMethods = { password: false, google: null, apple: relay };
    const s = providerRowState(m, "apple", "ios", APPLE_ONLY);
    expect(s).toMatchObject({ kind: "disconnect", enabled: false });
    expect(s.kind === "disconnect" && s.hint).toMatch(
      /another sign-in method/i,
    );
  });
  it("disconnect allowed when a password remains", () => {
    const m: SignInMethods = { password: true, google: null, apple: relay };
    expect(providerRowState(m, "apple", "ios", APPLE_ONLY)).toEqual({
      kind: "disconnect",
      enabled: true,
    });
  });
  it("Apple is hidden off iOS; Google hidden in an Apple-only build", () => {
    expect(providerRowState(pw, "apple", "android", APPLE_ONLY).kind).toBe(
      "hidden",
    );
    expect(providerRowState(pw, "google", "ios", APPLE_ONLY).kind).toBe(
      "hidden",
    );
  });
  it("a linked provider this build cannot open still shows, to disconnect", () => {
    const m: SignInMethods = {
      password: true,
      google: { email: "a@gmail.com" },
      apple: null,
    };
    expect(providerRowState(m, "google", "ios", APPLE_ONLY)).toEqual({
      kind: "disconnect",
      enabled: true,
    });
  });
});

describe("identityErrorMessage", () => {
  it.each([
    ["IDENTITY_IN_USE", 409, /another OCRecipes account/i],
    ["PROVIDER_ALREADY_CONNECTED", 409, /already connected/i],
    ["LAST_SIGN_IN_METHOD", 400, /another sign-in method/i],
    ["UNAUTHORIZED", 401, /incorrect password/i],
    ["RATE_LIMITED", 429, /too many/i],
  ])("%s → static copy", (code, status, re) => {
    expect(identityErrorMessage(new ApiError("raw", code, status))).toMatch(re);
  });
  it("never shows the server message", () => {
    expect(identityErrorMessage(new ApiError("secret", "X", 500))).not.toMatch(
      /secret/,
    );
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
