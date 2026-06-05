import { describe, it, expect } from "vitest";
import type { VerificationNutrition } from "@shared/types/verification";
import {
  valuesMatch,
  nutritionMatches,
  compareWithVerifications,
  computeConsensus,
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

  it("rejects a small value against a large value where only one side is <2 (5,0)", () => {
    // Kills line-73 mutants `if (b === 0)` and `if (a !== 0 && b === 0)`:
    // 5 vs 0 -> relative branch: |5-0|/5 = 1 > 0.05 -> false.
    expect(valuesMatch(5, 0)).toBe(false);
  });

  it("does not treat the small-value branch as reachable when only b is <2 (1.5,2.4)", () => {
    // Kills line-75 `||` and `a<2 && true`: |2.4|<2 is false so original uses the
    // relative branch: |1.5-2.4|/2.4 = 0.375 > 0.05 -> false.
    expect(valuesMatch(1.5, 2.4)).toBe(false);
  });

  it("does not treat the small-value branch as reachable when only a is <2 (2.4,1.5)", () => {
    // Kills line-75 `true && b<2`: |2.4|<2 false -> relative -> 0.375 > 0.05 -> false.
    expect(valuesMatch(2.4, 1.5)).toBe(false);
  });

  it("treats abs(b)===2 as NOT a small value (1,2)", () => {
    // Kills line-75 `Math.abs(b) <= 2`: |2| is not < 2, so relative branch:
    // |1-2|/2 = 0.5 > 0.05 -> false.
    expect(valuesMatch(1, 2)).toBe(false);
  });

  it("treats abs(a)===2 as NOT a small value (2,1)", () => {
    // Kills line-75 `Math.abs(a) <= 2`: relative branch -> |2-1|/2 = 0.5 > 0.05 -> false.
    expect(valuesMatch(2, 1)).toBe(false);
  });

  it("matches at exactly the 5% relative boundary using max (100,95)", () => {
    // Kills line-79 `<= 0.05` -> `< 0.05` AND line-78 `Math.max` -> `Math.min`:
    // |100-95|/max(100,95) = 5/100 = 0.05 -> true (<=). With min: 5/95 = 0.0526 > 0.05 -> would be false.
    expect(valuesMatch(100, 95)).toBe(true);
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

describe("computeConsensus", () => {
  it("averages all-present values: rounds calories to int, macros to 1dp", () => {
    const result = computeConsensus([
      nutrition({ calories: 100, protein: 10, totalCarbs: 20, totalFat: 5 }),
      nutrition({ calories: 101, protein: 11, totalCarbs: 21, totalFat: 6 }),
    ]);
    expect(result.calories).toBe(101); // round(100.5); kills round-removal, +/-, /*, sum/count
    expect(result.protein).toBe(10.5);
    expect(result.carbs).toBe(20.5);
    expect(result.fat).toBe(5.5);
  });

  it("counts only non-null entries per field (mixed nulls)", () => {
    const result = computeConsensus([
      nutrition({
        calories: null,
        protein: null,
        totalCarbs: 20,
        totalFat: null,
      }),
      nutrition({ calories: 200, protein: 10, totalCarbs: null, totalFat: 4 }),
    ]);
    // calories: one present (200) -> 200; protein: one -> 10; carbs: one -> 20; fat: one -> 4
    // Exercises each field's `!= null` guard with a null AND a present value,
    // including calories=null to kill the `if (v.calories != null) -> if (true)` mutant.
    expect(result).toEqual({ calories: 200, protein: 10, carbs: 20, fat: 4 });
  });

  it("returns 0 (not NaN) for a field when every value is null", () => {
    const result = computeConsensus([nutrition(), nutrition()]);
    // counts.x === 0 -> the `counts.x > 0 ? avg : 0` ternary must yield 0.
    // Kills the >0 boundary/conditional mutants (>=0, <=0, true, false).
    expect(result).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
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
