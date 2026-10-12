import { describe, it, expect } from "vitest";
import {
  passwordLength,
  newPasswordProblem,
  passwordMessage,
  PASSWORD_MIN,
} from "../password-policy";

describe("passwordLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect("😀".length).toBe(2);
    expect(passwordLength("😀")).toBe(1);
  });
  it("normalizes to NFC first, so decomposed and composed é are equal", () => {
    const composed = "é";
    const decomposed = "é";
    expect(decomposed.length).toBe(2);
    expect(passwordLength(composed)).toBe(1);
    expect(passwordLength(decomposed)).toBe(1);
  });
});

describe("newPasswordProblem", () => {
  it("the minimum is 8 for everyone (owner ruling 2026-10-12)", () => {
    expect(PASSWORD_MIN).toBe(8);
  });
  it.each([
    [7, "too_short"],
    [8, null],
    [128, null],
    [129, "too_long"],
  ] as const)("%i chars → %s", (n, want) => {
    expect(newPasswordProblem("a".repeat(n))).toBe(want);
  });
  it("has no composition rule: 8 letters only is fine", () => {
    expect(newPasswordProblem("abcdefgh")).toBeNull();
  });
  it("counts an emoji as one character at the boundary", () => {
    expect(newPasswordProblem("a".repeat(7) + "😀")).toBeNull();
  });
});

describe("passwordMessage", () => {
  it("one sentence per problem", () => {
    expect(passwordMessage("too_short")).toBe("Use at least 8 characters.");
    expect(passwordMessage("too_long")).toBe("Use at most 128 characters.");
  });
});
