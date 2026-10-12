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
    [7, PASSWORD_MIN_SINGLE_FACTOR, "too_short"],
    [8, PASSWORD_MIN_SINGLE_FACTOR, null],
    [7, PASSWORD_MIN_WITH_MFA, "too_short"],
    [8, PASSWORD_MIN_WITH_MFA, null],
    [128, PASSWORD_MIN_WITH_MFA, null],
    [129, PASSWORD_MIN_WITH_MFA, "too_long"],
  ] as const)("%i chars with min %i → %s", (n, min, want) => {
    expect(newPasswordProblem("a".repeat(n), { min })).toBe(want);
  });
  it("has no composition rule: 8 letters only is fine", () => {
    expect(newPasswordProblem("abcdefgh", { min: 8 })).toBeNull();
  });
  it("counts an emoji as one character at the boundary", () => {
    expect(newPasswordProblem("a".repeat(7) + "😀", { min: 8 })).toBeNull();
  });
});

describe("passwordMessage", () => {
  it("is 8 for everyone, whether or not two-step is on (owner ruling 2026-10-12)", () => {
    expect(PASSWORD_MIN_SINGLE_FACTOR).toBe(8);
    expect(PASSWORD_MIN_WITH_MFA).toBe(8);
    for (const context of ["signup", "single_factor", "mfa"] as const) {
      expect(passwordMessage("too_short", context)).toBe(
        "Use at least 8 characters.",
      );
    }
    expect(passwordMessage("too_long", "signup")).toBe(
      "Use at most 128 characters.",
    );
  });
});
