import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import { MAX_FAMILY_PROFILES } from "@shared/types/family";
import {
  describeFamilyError,
  summarizeAllergies,
  validateFamilyProfile,
} from "../family-profile-utils";

describe("summarizeAllergies", () => {
  it("says so when there are none", () => {
    expect(summarizeAllergies([])).toBe("No allergies listed");
  });
  it("lists display names, not ids", () => {
    expect(
      summarizeAllergies([
        { name: "peanuts", severity: "severe" },
        { name: "milk", severity: "mild" },
      ]),
    ).toBe("Peanuts, Dairy/Milk");
  });
  it("shortens a long list", () => {
    const all = ["peanuts", "milk", "eggs", "soy", "fish"].map((name) => ({
      name,
      severity: "mild" as const,
    }));
    expect(summarizeAllergies(all)).toBe("Peanuts, Dairy/Milk, Eggs + 2 more");
  });
});

describe("describeFamilyError", () => {
  it.each([
    [ErrorCode.PREMIUM_REQUIRED, /premium/i],
    [ErrorCode.HEALTH_CONSENT_REQUIRED, /consent/i],
    [ErrorCode.LIMIT_REACHED, new RegExp(`${MAX_FAMILY_PROFILES}`)],
    [ErrorCode.RATE_LIMITED, /wait/i],
  ])("maps %s to plain words", (code, pattern) => {
    expect(
      describeFamilyError(new ApiError("403: raw body", code, 403)),
    ).toMatch(pattern);
  });

  it("never shows the raw server text", () => {
    const text = describeFamilyError(
      new ApiError("500: secret internals", undefined, 500),
    );
    expect(text).not.toMatch(/secret|500/);
    expect(text).toMatch(/try again/i);
    expect(describeFamilyError(new Error("boom"))).not.toMatch(/boom/);
  });
});

describe("validateFamilyProfile", () => {
  it("trims the name and turns a blank note into null", () => {
    const result = validateFamilyProfile({
      name: "  Ivy ",
      allergies: [{ name: "milk", severity: "mild" }],
      note: "   ",
    });
    expect(result).toEqual({
      ok: true,
      input: {
        name: "Ivy",
        allergies: [{ name: "milk", severity: "mild" }],
        note: null,
      },
    });
  });

  it("rejects a blank name with plain words", () => {
    const result = validateFamilyProfile({
      name: "   ",
      allergies: [],
      note: "",
    });
    expect(result).toEqual({
      ok: false,
      message: "Enter a name for this person.",
    });
  });

  it("rejects a name or note that is too long", () => {
    expect(
      validateFamilyProfile({ name: "x".repeat(51), allergies: [], note: "" }),
    ).toEqual({
      ok: false,
      message: "Use 50 characters or fewer for the name.",
    });
    expect(
      validateFamilyProfile({
        name: "Ivy",
        allergies: [],
        note: "x".repeat(201),
      }),
    ).toEqual({
      ok: false,
      message: "Use 200 characters or fewer for the note.",
    });
  });
});
