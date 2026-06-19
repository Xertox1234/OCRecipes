import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import {
  signVerificationToken,
  verifyVerificationToken,
} from "../verification-token";

// JWT_SECRET is set by the global test setup (test/setup.ts), which runs BEFORE
// this module is imported — so verification-token.ts's load-time
// `if (!JWT_SECRET) throw` is already satisfied. No local fallback is needed
// (a beforeAll would run too late — after the static import has already thrown).

describe("verification-token", () => {
  it("round-trips a valid token", () => {
    const token = signVerificationToken("user-123", "a@b.com");
    const payload = verifyVerificationToken(token);
    expect(payload).toEqual({
      sub: "user-123",
      email: "a@b.com",
      purpose: "email-verify",
    });
  });

  it("rejects an expired token", () => {
    const secret = process.env.JWT_SECRET as string;
    const expired = jwt.sign(
      { email: "a@b.com", purpose: "email-verify" },
      secret,
      {
        subject: "user-123",
        audience: "ocrecipes-email-verify",
        issuer: "ocrecipes-api",
        expiresIn: -10,
      },
    );
    expect(verifyVerificationToken(expired)).toBeNull();
  });

  it("rejects an access token presented as a verification token (audience mismatch)", () => {
    const secret = process.env.JWT_SECRET as string;
    const accessToken = jwt.sign({ sub: "user-123", tokenVersion: 0 }, secret, {
      audience: "ocrecipes-client",
      issuer: "ocrecipes-api",
      expiresIn: "7d",
    });
    expect(verifyVerificationToken(accessToken)).toBeNull();
  });

  it("rejects a tampered token", () => {
    const token = signVerificationToken("user-123", "a@b.com");
    expect(verifyVerificationToken(token.slice(0, -2) + "xx")).toBeNull();
  });
});
