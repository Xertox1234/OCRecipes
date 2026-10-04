import { describe, it, expect } from "vitest";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  loginSchema,
  registerSchema,
} from "../_schemas";

describe("password-reset schemas", () => {
  it("forgot: trims and lowercases the email", () => {
    expect(forgotPasswordSchema.parse({ email: "  Foo@X.com " }).email).toBe(
      "foo@x.com",
    );
  });
  it("forgot: rejects a non-email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(
      false,
    );
  });
  it("reset: accepts exactly 6 digits only", () => {
    const base = { email: "a@b.com", newPassword: "abcdefg1" };
    expect(
      resetPasswordSchema.safeParse({ ...base, code: "012345" }).success,
    ).toBe(true);
    for (const code of ["12345", "1234567", "12a456", "123 456"]) {
      expect(resetPasswordSchema.safeParse({ ...base, code }).success).toBe(
        false,
      );
    }
  });
  it("reset: applies the same password rule as register", () => {
    const resetBase = { email: "a@b.com", code: "123456" };
    const registerBase = {
      username: "abc",
      email: "a@b.com",
      ageConfirmed: true,
    };
    // Positive control: a valid password passes both, so the rejections below
    // are about the password and nothing else.
    expect(
      resetPasswordSchema.safeParse({ ...resetBase, newPassword: "abcdefg1" })
        .success,
    ).toBe(true);
    expect(
      registerSchema.safeParse({ ...registerBase, password: "abcdefg1" })
        .success,
    ).toBe(true);
    for (const pw of ["short1", "allletters", "12345678"]) {
      expect(
        resetPasswordSchema.safeParse({ ...resetBase, newPassword: pw })
          .success,
      ).toBe(false);
      expect(
        registerSchema.safeParse({ ...registerBase, password: pw }).success,
      ).toBe(false);
    }
  });
  it("login: trims and allows an email-length identifier", () => {
    const long = `${"a".repeat(60)}@example.com`;
    expect(
      loginSchema.parse({ username: `  ${long} `, password: "x" }).username,
    ).toBe(long);
  });
});
