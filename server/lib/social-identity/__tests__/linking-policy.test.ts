import { describe, it, expect } from "vitest";
import { decideLink, isAuthoritative } from "../linking-policy";
import type { ProviderClaims } from "../types";

const g = (o: Partial<ProviderClaims> = {}): ProviderClaims => ({
  provider: "google",
  sub: "g1",
  email: "me@gmail.com",
  emailVerified: true,
  hostedDomain: null,
  isPrivateRelay: false,
  nonce: null,
  ...o,
});
const a = (o: Partial<ProviderClaims> = {}): ProviderClaims => ({
  provider: "apple",
  sub: "a1",
  email: "me@icloud.com",
  emailVerified: true,
  hostedDomain: null,
  isPrivateRelay: false,
  nonce: null,
  ...o,
});
const acct = (o = {}) => ({
  id: "u1",
  email: "me@gmail.com",
  emailVerified: true,
  hasSecondFactor: false,
  methods: ["password" as const],
  ...o,
});

describe("isAuthoritative", () => {
  it.each([
    ["gmail", g(), true],
    ["GMAIL uppercase", g({ email: "Me@GMAIL.com" }), true],
    ["googlemail", g({ email: "me@googlemail.com" }), true],
    [
      "workspace hd + verified",
      g({ email: "me@acme.com", hostedDomain: "acme.com" }),
      true,
    ],
    [
      "workspace hd but unverified",
      g({
        email: "me@acme.com",
        hostedDomain: "acme.com",
        emailVerified: false,
      }),
      false,
    ],
    ["other domain, verified, no hd", g({ email: "me@yahoo.com" }), false],
    ["apple non-relay verified", a(), true],
    [
      "apple relay",
      a({ email: "x@privaterelay.appleid.com", isPrivateRelay: true }),
      false,
    ],
    ["apple unverified", a({ emailVerified: false }), false],
    ["no email", g({ email: null }), false],
  ])("%s", (_n, claims, expected) => {
    expect(isAuthoritative(claims)).toBe(expected);
  });
});

describe("decideLink", () => {
  it("already linked → sign_in, even if an MFA account owns the email", () => {
    expect(
      decideLink({
        claims: g(),
        linkedUserId: "u9",
        emailAccount: acct({ hasSecondFactor: true }),
      }),
    ).toEqual({ kind: "sign_in", userId: "u9" });
  });
  it("no account with the email → choose_username", () => {
    expect(
      decideLink({ claims: g(), linkedUserId: null, emailAccount: null }),
    ).toEqual({ kind: "choose_username" });
  });
  it("gmail + verified account + no MFA → auto_link", () => {
    expect(
      decideLink({ claims: g(), linkedUserId: null, emailAccount: acct() }),
    ).toEqual({ kind: "auto_link", userId: "u1" });
  });
  it("MFA account is never auto-linked", () => {
    expect(
      decideLink({
        claims: g(),
        linkedUserId: null,
        emailAccount: acct({ hasSecondFactor: true }),
      }),
    ).toEqual({ kind: "link_required", userId: "u1", methods: ["password"] });
  });
  it("non-authoritative google address → link_required", () => {
    expect(
      decideLink({
        claims: g({ email: "me@yahoo.com" }),
        linkedUserId: null,
        emailAccount: acct({ email: "me@yahoo.com" }),
      }).kind,
    ).toBe("link_required");
  });
  it("account email not verified → link_required", () => {
    expect(
      decideLink({
        claims: g(),
        linkedUserId: null,
        emailAccount: acct({ emailVerified: false }),
      }).kind,
    ).toBe("link_required");
  });
  it("apple relay never auto-links", () => {
    const relay = "x@privaterelay.appleid.com";
    expect(
      decideLink({
        claims: a({ email: relay, isPrivateRelay: true }),
        linkedUserId: null,
        emailAccount: acct({ email: relay }),
      }).kind,
    ).toBe("link_required");
  });
  it("reports an apple-only account's methods", () => {
    expect(
      decideLink({
        claims: g(),
        linkedUserId: null,
        emailAccount: acct({ methods: ["apple"], hasSecondFactor: true }),
      }),
    ).toEqual({ kind: "link_required", userId: "u1", methods: ["apple"] });
  });
});
