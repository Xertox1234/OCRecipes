import { describe, it, expect } from "vitest";
import type { VerificationNutrition } from "@shared/types/verification";
import {
  valuesMatch,
  nutritionMatches,
  compareWithVerifications,
} from "../verification-consensus";

/** Build a VerificationNutrition with all fields null, overriding as needed. */
function nutrition(
  overrides: Partial<VerificationNutrition> = {},
): VerificationNutrition {
  return {
    calories: null,
    protein: null,
    totalCarbs: null,
    totalFat: null,
    ...overrides,
  };
}

describe("valuesMatch", () => {
  it("returns true for identical values", () => {
    expect(valuesMatch(100, 100)).toBe(true);
  });

  it("returns true when both values are zero", () => {
    expect(valuesMatch(0, 0)).toBe(true);
  });

  it("matches zero against a small value via the <2 absolute-1 tolerance", () => {
    // Current behaviour: 0 and 1 are both < 2, so |0 - 1| = 1 <= 1 -> match.
    expect(valuesMatch(0, 1)).toBe(true);
    expect(valuesMatch(1, 0)).toBe(true);
  });

  it("does not match zero against a large value (relative tolerance)", () => {
    // 5 is not < 2, so the relative branch applies: |0 - 5| / 5 = 1 > 0.05.
    expect(valuesMatch(0, 5)).toBe(false);
  });

  it("matches values just inside the 5% relative boundary", () => {
    // |100 - 105| / 105 = 0.0476... <= 0.05
    expect(valuesMatch(100, 105)).toBe(true);
    expect(valuesMatch(100, 104)).toBe(true);
  });

  it("rejects values just outside the 5% relative boundary", () => {
    // |100 - 106| / 106 = 0.0566... > 0.05
    expect(valuesMatch(100, 106)).toBe(false);
    // |100 - 94| / 100 = 0.06 > 0.05
    expect(valuesMatch(100, 94)).toBe(false);
  });

  it("matches small values (<2) just inside the absolute-1 tolerance", () => {
    // |1 - 1.9| = 0.9 <= 1
    expect(valuesMatch(1, 1.9)).toBe(true);
  });

  it("rejects small values (<2) just outside the absolute-1 tolerance", () => {
    // 0.5 and 1.6 are both < 2: |0.5 - 1.6| = 1.1 > 1
    expect(valuesMatch(0.5, 1.6)).toBe(false);
  });
});

describe("nutritionMatches", () => {
  it("returns false when both extractions are all-null (nothing compared)", () => {
    expect(nutritionMatches(nutrition(), nutrition())).toBe(false);
  });

  it("returns true when all shared non-null fields match", () => {
    const a = nutrition({
      calories: 200,
      protein: 10,
      totalCarbs: 30,
      totalFat: 5,
    });
    const b = nutrition({
      calories: 205,
      protein: 10,
      totalCarbs: 31,
      totalFat: 5,
    });
    expect(nutritionMatches(a, b)).toBe(true);
  });

  it("returns false when any shared non-null field diverges", () => {
    const a = nutrition({ calories: 200, protein: 10 });
    const b = nutrition({ calories: 200, protein: 20 });
    expect(nutritionMatches(a, b)).toBe(false);
  });

  it("ignores fields that are null on either side and matches on the overlap", () => {
    // Only `calories` is non-null on both sides; the null fields are skipped.
    const a = nutrition({ calories: 200, protein: 10 });
    const b = nutrition({ calories: 205, totalFat: 5 });
    expect(nutritionMatches(a, b)).toBe(true);
  });

  it("returns false when partial-null fields have no overlapping non-null field", () => {
    // a has only calories, b has only protein -> comparedCount stays 0 -> false.
    const a = nutrition({ calories: 200 });
    const b = nutrition({ protein: 10 });
    expect(nutritionMatches(a, b)).toBe(false);
  });
});

describe("compareWithVerifications", () => {
  it("returns isMatch:true for empty history regardless of content (current behaviour — todo 2026-05-18-verification-presubmit-ismatch-race)", () => {
    // First verification always matches; even an all-null extraction passes.
    expect(compareWithVerifications(nutrition(), [])).toEqual({
      isMatch: true,
      matchCount: 0,
    });
    expect(compareWithVerifications(nutrition({ calories: 200 }), [])).toEqual({
      isMatch: true,
      matchCount: 0,
    });
  });

  it("matches when the extraction agrees with all existing verifications", () => {
    const extracted = nutrition({ calories: 200, protein: 10 });
    const existing = [
      nutrition({ calories: 205, protein: 10 }),
      nutrition({ calories: 198, protein: 10 }),
    ];
    expect(compareWithVerifications(extracted, existing)).toEqual({
      isMatch: true,
      matchCount: 2,
    });
  });

  it("does not match when the extraction diverges from all existing verifications", () => {
    const extracted = nutrition({ calories: 200, protein: 10 });
    const existing = [
      nutrition({ calories: 400, protein: 30 }),
      nutrition({ calories: 50, protein: 1 }),
    ];
    expect(compareWithVerifications(extracted, existing)).toEqual({
      isMatch: false,
      matchCount: 0,
    });
  });

  it("matches via pairwise agreement with at least one of several divergent entries", () => {
    const extracted = nutrition({ calories: 200, protein: 10 });
    const existing = [
      nutrition({ calories: 205, protein: 10 }), // matches
      nutrition({ calories: 400, protein: 30 }), // diverges
      nutrition({ calories: 50, protein: 1 }), // diverges
    ];
    expect(compareWithVerifications(extracted, existing)).toEqual({
      isMatch: true,
      matchCount: 1,
    });
  });
});
