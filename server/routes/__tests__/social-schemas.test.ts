import { describe, it, expect } from "vitest";
import {
  socialSignInSchema,
  completeSocialSignUpSchema,
  socialLinkSchema,
  socialNonceSchema,
} from "../_schemas";

describe("social schemas", () => {
  it("sign-in accepts google without code and apple with code + name", () => {
    expect(
      socialSignInSchema.safeParse({
        provider: "google",
        idToken: "t",
        nonce: "n",
      }).success,
    ).toBe(true);
    expect(
      socialSignInSchema.safeParse({
        provider: "apple",
        idToken: "t",
        nonce: "n",
        authorizationCode: "c",
        fullName: { givenName: "A", familyName: null },
      }).success,
    ).toBe(true);
    expect(
      socialSignInSchema.safeParse({
        provider: "facebook",
        idToken: "t",
        nonce: "n",
      }).success,
    ).toBe(false);
  });
  it("complete-sign-up requires ageConfirmed: true and a valid username", () => {
    expect(
      completeSocialSignUpSchema.safeParse({
        ticket: "t",
        username: "ok_name",
        ageConfirmed: true,
      }).success,
    ).toBe(true);
    expect(
      completeSocialSignUpSchema.safeParse({
        ticket: "t",
        username: "ok_name",
        ageConfirmed: false,
      }).success,
    ).toBe(false);
    expect(
      completeSocialSignUpSchema.safeParse({
        ticket: "t",
        username: "no spaces",
        ageConfirmed: true,
      }).success,
    ).toBe(false);
  });
  it("link accepts password OR provider proof, not neither", () => {
    expect(
      socialLinkSchema.safeParse({ ticket: "t", password: "p" }).success,
    ).toBe(true);
    expect(
      socialLinkSchema.safeParse({
        ticket: "t",
        provider: "apple",
        idToken: "i",
        nonce: "n",
      }).success,
    ).toBe(true);
    expect(socialLinkSchema.safeParse({ ticket: "t" }).success).toBe(false);
  });
  it("nonce purpose is an enum", () => {
    expect(socialNonceSchema.safeParse({ purpose: "reauth" }).success).toBe(
      true,
    );
    expect(socialNonceSchema.safeParse({ purpose: "admin" }).success).toBe(
      false,
    );
  });
});
