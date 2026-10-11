import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  validateUsername,
  validateAuthForm,
  validateAuthFormFields,
  getAuthErrorMessage,
  validateNewPassword,
  PASSWORD_MISMATCH_MESSAGE,
} from "../LoginScreen-utils";

describe("validateUsername (mirrors registerSchema)", () => {
  it.each([
    ["ok_name", null],
    ["ab", /between 3 and 30/],
    ["a".repeat(31), /between 3 and 30/],
    ["has space", /letters, numbers, and underscores/],
    ["me@x.com", /letters, numbers, and underscores/],
  ])("%s", (u, expected) => {
    const out = validateUsername(u);
    if (expected === null) expect(out).toBeNull();
    else expect(out).toMatch(expected);
  });
});

describe("validateAuthForm", () => {
  const validRegister = {
    mode: "register" as const,
    username: "chef_tony",
    email: "chef@example.com",
    password: "recipe-passphrase-1",
    confirmPassword: "recipe-passphrase-1",
    ageConfirmed: true,
  };

  it("returns null for a fully valid registration", () => {
    expect(validateAuthForm(validRegister)).toBeNull();
  });

  it("returns null for a login with any non-empty credentials (lenient)", () => {
    // Login must stay lenient client-side: the server is the authority and a
    // generic failure avoids a username-enumeration oracle.
    expect(
      validateAuthForm({
        mode: "login",
        username: "user@example.com", // an email is a fine *login* identifier client-side
        password: "x",
        confirmPassword: "",
        ageConfirmed: false,
        email: "",
      }),
    ).toBeNull();
  });

  it("flags empty fields", () => {
    expect(
      validateAuthForm({ ...validRegister, username: "   ", password: "" }),
    ).toBe("Please fill in all fields");
  });

  // THE BUG: a user typing their email address into the "Username" field.
  it("rejects an email address as the username with an actionable message", () => {
    const msg = validateAuthForm({
      ...validRegister,
      username: "william.tower@gmail.com",
    });
    expect(msg).toMatch(/letters, numbers, and underscores/i);
    // Should hint that an email is not allowed, since that's the common trap.
    expect(msg).toMatch(/email/i);
  });

  it("rejects a username shorter than 3 characters", () => {
    expect(validateAuthForm({ ...validRegister, username: "ab" })).toMatch(
      /3 (and|to|-).*30|at least 3/i,
    );
  });

  it("rejects a username longer than 30 characters", () => {
    expect(
      validateAuthForm({ ...validRegister, username: "a".repeat(31) }),
    ).toMatch(/30/);
  });

  it("rejects a register with a missing email", () => {
    expect(validateAuthForm({ ...validRegister, email: "" })).toBe(
      "Please enter your email address",
    );
  });

  it("rejects a register with a malformed email", () => {
    expect(validateAuthForm({ ...validRegister, email: "not-an-email" })).toBe(
      "Please enter a valid email address",
    );
  });

  it("ignores email in login mode", () => {
    expect(
      validateAuthForm({
        mode: "login",
        username: "chef_tony",
        password: "x",
        confirmPassword: "",
        ageConfirmed: false,
        email: "",
      }),
    ).toBeNull();
  });

  it("rejects a 14-character password with the sign-up minimum", () => {
    expect(
      validateAuthForm({
        ...validRegister,
        password: "a".repeat(14),
        confirmPassword: "a".repeat(14),
      }),
    ).toBe("Use at least 15 characters.");
  });

  it("has no composition rule: 15 letters only is fine", () => {
    expect(
      validateAuthForm({
        ...validRegister,
        password: "abcdefghijklmno",
        confirmPassword: "abcdefghijklmno",
      }),
    ).toBeNull();
  });

  it("rejects mismatched passwords", () => {
    expect(
      validateAuthForm({
        ...validRegister,
        confirmPassword: "recipe-passphrase-2",
      }),
    ).toBe("Passwords do not match");
  });

  it("rejects when the age checkbox is unconfirmed", () => {
    expect(validateAuthForm({ ...validRegister, ageConfirmed: false })).toMatch(
      /13 years/i,
    );
  });
});

describe("validateAuthFormFields", () => {
  const validRegister = {
    mode: "register" as const,
    username: "chef_tony",
    email: "chef@example.com",
    password: "Recipe123",
    confirmPassword: "Recipe123",
    ageConfirmed: true,
  };

  it("returns no email error for a valid register email", () => {
    expect(validateAuthFormFields(validRegister)).toEqual({ email: null });
  });

  it("attributes a missing email to the email field", () => {
    expect(validateAuthFormFields({ ...validRegister, email: "" })).toEqual({
      email: "Please enter your email address",
    });
  });

  it("attributes a malformed email to the email field", () => {
    expect(
      validateAuthFormFields({ ...validRegister, email: "not-an-email" }),
    ).toEqual({ email: "Please enter a valid email address" });
  });

  it("never produces an email error in login mode, even with a bad email (lenient, no enumeration oracle)", () => {
    // The email field is not shown in login mode; field validation must stay
    // inert there so login validation does not become strict.
    expect(
      validateAuthFormFields({
        mode: "login",
        username: "user@example.com",
        password: "x",
        confirmPassword: "",
        ageConfirmed: false,
        email: "not-an-email",
      }),
    ).toEqual({ email: null });
  });

  it("does not flag the email field when a non-email field is the failure", () => {
    // A valid email but mismatched passwords → email is NOT attributed an error.
    expect(
      validateAuthFormFields({
        ...validRegister,
        confirmPassword: "Recipe124",
      }),
    ).toEqual({ email: null });
  });
});

describe("getAuthErrorMessage", () => {
  it("returns static rate-limit copy for a RATE_LIMITED ApiError", () => {
    const msg = getAuthErrorMessage(
      new ApiError("429: too many", "RATE_LIMITED"),
      "register",
    );
    expect(msg).toMatch(/too many/i);
    expect(msg).toMatch(/wait|try again/i);
  });

  it("returns generic register copy for a non-rate-limit ApiError (no raw message)", () => {
    const raw = '409: {"error":"Username already exists"}';
    const msg = getAuthErrorMessage(new ApiError(raw, "CONFLICT"), "register");
    expect(msg).toBe("Registration failed. Please try again.");
    // The raw server body must never leak into the UI copy.
    expect(msg).not.toContain("already exists");
    expect(msg).not.toContain("409");
  });

  it("returns generic login copy for a login failure (no enumeration oracle)", () => {
    const msg = getAuthErrorMessage(
      new ApiError("401: invalid", "UNAUTHORIZED"),
      "login",
    );
    expect(msg).toBe("Incorrect username or password. Please try again.");
  });

  it("register: a too-short password from the server gets the length sentence", () => {
    expect(
      getAuthErrorMessage(
        new ApiError("400: short", "PASSWORD_TOO_SHORT"),
        "register",
      ),
    ).toBe("Use at least 15 characters.");
  });

  it("register: a breached password gets the breach sentence", () => {
    expect(
      getAuthErrorMessage(
        new ApiError("400: breached", "PASSWORD_BREACHED"),
        "register",
      ),
    ).toBe(
      "That password has appeared in a data breach. Choose a different one.",
    );
  });

  it("login never shows the password-policy copy (stays generic)", () => {
    expect(
      getAuthErrorMessage(
        new ApiError("400: short", "PASSWORD_TOO_SHORT"),
        "login",
      ),
    ).toBe("Incorrect username or password. Please try again.");
  });

  it("returns generic copy for a plain (non-ApiError) Error", () => {
    expect(
      getAuthErrorMessage(new Error("500: boom from server"), "register"),
    ).toBe("Registration failed. Please try again.");
    expect(getAuthErrorMessage(new Error("network down"), "login")).toBe(
      "Incorrect username or password. Please try again.",
    );
  });
});

describe("validateNewPassword (the shared password policy)", () => {
  const signup = { min: 15, context: "signup" as const };
  const floor = { min: 8, context: "mfa" as const };

  it("enforces length, then match, in that order", () => {
    expect(validateNewPassword("a".repeat(14), "a".repeat(14), signup)).toBe(
      "Use at least 15 characters.",
    );
    expect(validateNewPassword("a".repeat(129), "a".repeat(129), signup)).toBe(
      "Use at most 128 characters.",
    );
    expect(validateNewPassword("a".repeat(15), "b".repeat(15), signup)).toBe(
      "Passwords do not match",
    );
    expect(validateNewPassword("a".repeat(15), "a".repeat(15), signup)).toBeNull();
  });

  it("the floor accepts 8 and refuses 7", () => {
    expect(validateNewPassword("abcdefgh", "abcdefgh", floor)).toBeNull();
    expect(validateNewPassword("abcdefg", "abcdefg", floor)).toBe(
      "Use at least 8 characters.",
    );
  });

  it("counts an emoji as one character", () => {
    const pw = "a".repeat(14) + "😀";
    expect(validateNewPassword(pw, pw, signup)).toBeNull();
  });

  it("returns the exported mismatch constant, so callers can match on it", () => {
    expect(PASSWORD_MISMATCH_MESSAGE).toBe("Passwords do not match");
    expect(validateNewPassword("abcdefgh", "abcdefgi", floor)).toBe(
      PASSWORD_MISMATCH_MESSAGE,
    );
  });
});
