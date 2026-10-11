import { describe, it, expect } from "vitest";
import {
  passwordLength,
  newPasswordProblem,
  passwordMessage,
  PASSWORD_MIN_SINGLE_FACTOR,
  PASSWORD_MIN_WITH_MFA,
} from "../password-policy";

describe("passwordLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect("😀".length).toBe(2);
    expect(passwordLength("😀")).toBe(1);
  });
  it("normalizes to NFC first, so decomposed and composed é are equal", () => {
    const composed = "\u00e9";
    const decomposed = "e\u0301";
    expect(decomposed.length).toBe(2);
    expect(passwordLength(composed)).toBe(1);
    expect(passwordLength(decomposed)).toBe(1);
  });
});

describe("newPasswordProblem", () => {
  it.each([
    [14, PASSWORD_MIN_SINGLE_FACTOR, "too_short"],
    [15, PASSWORD_MIN_SINGLE_FACTOR, null],
    [7, PASSWORD_MIN_WITH_MFA, "too_short"],
    [8, PASSWORD_MIN_WITH_MFA, null],
    [128, PASSWORD_MIN_WITH_MFA, null],
    [129, PASSWORD_MIN_WITH_MFA, "too_long"],
  ] as const)("%i chars with min %i → %s", (n, min, want) => {
    expect(newPasswordProblem("a".repeat(n), { min })).toBe(want);
  });
  it("has no composition rule: 15 letters only is fine", () => {
    expect(newPasswordProblem("abcdefghijklmno", { min: 15 })).toBeNull();
  });
  it("counts an emoji as one character at the boundary", () => {
    expect(newPasswordProblem("a".repeat(14) + "😀", { min: 15 })).toBeNull();
  });
});

describe("passwordMessage", () => {
  it("one sentence per context", () => {
    expect(passwordMessage("too_short", "signup")).toBe(
      "Use at least 15 characters, or turn on two-step verification to use 8.",
    );
    expect(passwordMessage("too_short", "single_factor")).toBe(
      "Use at least 15 characters.",
    );
    expect(passwordMessage("too_short", "mfa")).toBe(
      "Use at least 8 characters.",
    );
    expect(passwordMessage("too_long", "signup")).toBe(
      "Use at most 128 characters.",
    );
  });
});
