import { describe, it, expect } from "vitest";

import {
  confirmRules,
  passwordRules,
  rulesVisible,
  usernameRules,
} from "../field-rules";
import { PASSWORD_MAX, PASSWORD_MIN } from "@shared/constants/password-policy";
import { USERNAME_MAX, USERNAME_MIN } from "@shared/constants/username";

describe("passwordRules", () => {
  it("is unmet one character short of the minimum", () => {
    const [min] = passwordRules("1234567");
    expect(min).toEqual({
      id: "min",
      label: `At least ${PASSWORD_MIN} characters`,
      met: false,
    });
  });

  it("is met at the minimum", () => {
    expect(passwordRules("12345678")[0].met).toBe(true);
  });

  it("counts NFC code points, not UTF-16 units", () => {
    // "e" + combining acute → one "é" after NFC.
    expect(passwordRules("é".repeat(8))[0].met).toBe(true);
    expect(passwordRules("é".repeat(8))[0].met).toBe(true);
    expect(passwordRules("é".repeat(7))[0].met).toBe(false);
  });

  it("adds an unmet max rule only past the maximum", () => {
    expect(passwordRules("a".repeat(PASSWORD_MAX))).toHaveLength(1);
    const rules = passwordRules("a".repeat(PASSWORD_MAX + 1));
    expect(rules).toHaveLength(2);
    expect(rules[1]).toEqual({
      id: "max",
      label: `At most ${PASSWORD_MAX} characters`,
      met: false,
    });
  });
});

describe("confirmRules", () => {
  it("is unmet while empty, even against an empty password", () => {
    expect(confirmRules("", "")).toEqual([
      { id: "match", label: "Matches", met: false },
    ]);
  });
  it("is unmet when different and met when equal", () => {
    expect(confirmRules("abcdefgh", "abcdefg")[0].met).toBe(false);
    expect(confirmRules("abcdefgh", "abcdefgh")[0].met).toBe(true);
  });
});

describe("usernameRules", () => {
  const met = (u: string) =>
    Object.fromEntries(usernameRules(u).map((r) => [r.id, r.met]));

  it("labels the rules from the shared limits", () => {
    expect(usernameRules("").map((r) => r.label)).toEqual([
      `${USERNAME_MIN}–${USERNAME_MAX} characters`,
      "Letters, numbers or _",
    ]);
    expect(usernameRules("")[0].label).toBe("3–30 characters");
  });

  it('"ab" is too short but has allowed characters', () => {
    expect(met("ab")).toEqual({ length: false, chars: true });
  });

  it('"ab-c" has the length but a disallowed character', () => {
    expect(met("ab-c")).toEqual({ length: true, chars: false });
  });

  it('"chef_1" meets every rule', () => {
    expect(met("chef_1")).toEqual({ length: true, chars: true });
  });

  it("an empty name meets neither rule", () => {
    expect(met("")).toEqual({ length: false, chars: false });
  });

  it("is too long past the maximum", () => {
    expect(met("a".repeat(USERNAME_MAX))).toEqual({
      length: true,
      chars: true,
    });
    expect(met("a".repeat(USERNAME_MAX + 1)).length).toBe(false);
  });
});

describe("rulesVisible", () => {
  const unmet = [{ id: "a", label: "A", met: false }];
  const allMet = [{ id: "a", label: "A", met: true }];

  it("shows while the field is focused, met or not", () => {
    expect(rulesVisible({ focused: true, checked: false, rules: allMet })).toBe(
      true,
    );
    expect(rulesVisible({ focused: true, checked: false, rules: unmet })).toBe(
      true,
    );
  });

  it("shows after the field is checked only while a rule is unmet", () => {
    expect(rulesVisible({ focused: false, checked: true, rules: unmet })).toBe(
      true,
    );
    expect(rulesVisible({ focused: false, checked: true, rules: allMet })).toBe(
      false,
    );
  });

  it("stays hidden before focus or a check", () => {
    expect(rulesVisible({ focused: false, checked: false, rules: unmet })).toBe(
      false,
    );
  });
});
