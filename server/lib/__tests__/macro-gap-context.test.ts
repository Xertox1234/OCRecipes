import { describe, it, expect } from "vitest";
import { buildMacroGapEmphasis } from "../macro-gap-context";
import type { MacroTargets } from "../macro-gap-context";

describe("buildMacroGapEmphasis", () => {
  it("returns empty string when all macros have ≥70% remaining (no gap)", () => {
    const targets: MacroTargets = {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 70,
    };
    // All at exactly 70% remaining → 30% consumed → NOT strictly > 30%
    const remaining: MacroTargets = {
      calories: 1400,
      protein: 105,
      carbs: 140,
      fat: 49,
    };
    expect(buildMacroGapEmphasis(targets, remaining)).toBe("");
  });

  it("returns empty string when protein is exactly 30% short (threshold is strict >)", () => {
    const targets: MacroTargets = {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 70,
    };
    // Protein remaining = 105g → consumed 45g → ratio = 45/150 = 0.30 exactly → NOT triggered
    const remaining: MacroTargets = {
      calories: 2000,
      protein: 105,
      carbs: 200,
      fat: 70,
    };
    expect(buildMacroGapEmphasis(targets, remaining)).toBe("");
  });

  it("returns protein emphasis when protein is 31% short", () => {
    const targets: MacroTargets = {
      calories: 2000,
      protein: 100,
      carbs: 200,
      fat: 70,
    };
    // 31% short: consumed 31g, remaining 69g
    const remaining: MacroTargets = {
      calories: 2000,
      protein: 69,
      carbs: 200,
      fat: 70,
    };
    const result = buildMacroGapEmphasis(targets, remaining);
    expect(result).toContain("protein");
    expect(result).toContain("30g");
  });

  it("returns carbs emphasis when carbs is 31% short", () => {
    const targets: MacroTargets = {
      calories: 2000,
      protein: 150,
      carbs: 100,
      fat: 70,
    };
    // 31% short: consumed 31g, remaining 69g
    const remaining: MacroTargets = {
      calories: 2000,
      protein: 150,
      carbs: 69,
      fat: 70,
    };
    const result = buildMacroGapEmphasis(targets, remaining);
    expect(result).toContain("carbs");
    expect(result).toContain("40g");
  });

  it("returns fat emphasis when fat is 31% short", () => {
    const targets: MacroTargets = {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 100,
    };
    // 31% short: consumed 31g, remaining 69g
    const remaining: MacroTargets = {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 69,
    };
    const result = buildMacroGapEmphasis(targets, remaining);
    expect(result).toContain("fat");
    expect(result).toContain("15g");
  });

  it("returns calories emphasis when calories is 31% short", () => {
    const targets: MacroTargets = {
      calories: 1000,
      protein: 150,
      carbs: 200,
      fat: 70,
    };
    // 31% short: consumed 310 cal, remaining 690 cal
    const remaining: MacroTargets = {
      calories: 690,
      protein: 150,
      carbs: 200,
      fat: 70,
    };
    const result = buildMacroGapEmphasis(targets, remaining);
    expect(result).toContain("calories");
    expect(result).toContain("500cal");
  });

  it("picks the macro with the largest gap ratio when multiple macros are short", () => {
    const targets: MacroTargets = {
      calories: 2000,
      protein: 100,
      fat: 100,
      carbs: 200,
    };
    // Protein: 40% short (remaining 60g, gap 40g)
    // Fat: 60% short (remaining 40g, gap 60g) → fat wins
    const remaining: MacroTargets = {
      calories: 2000,
      protein: 60,
      fat: 40,
      carbs: 200,
    };
    const result = buildMacroGapEmphasis(targets, remaining);
    expect(result).toContain("fat");
    expect(result).not.toContain("protein");
  });

  it("skips macros with zero target (no division by zero)", () => {
    const targets: MacroTargets = {
      calories: 2000,
      protein: 0, // zero target → should be skipped
      carbs: 200,
      fat: 70,
    };
    const remaining: MacroTargets = {
      calories: 2000,
      protein: -50, // very negative, but zero target → skip
      carbs: 200,
      fat: 70,
    };
    // No macro exceeds threshold → empty string
    expect(buildMacroGapEmphasis(targets, remaining)).toBe("");
  });

  it("clamps remaining > target to 0 gap (no false positive)", () => {
    const targets: MacroTargets = {
      calories: 2000,
      protein: 100,
      carbs: 200,
      fat: 70,
    };
    // remaining.protein > target → clamps, ratio = 0 → no gap
    const remaining: MacroTargets = {
      calories: 2000,
      protein: 200, // more than target
      carbs: 200,
      fat: 70,
    };
    expect(buildMacroGapEmphasis(targets, remaining)).toBe("");
  });

  it("clamps negative remaining to 0 (treats as 100% consumed)", () => {
    // protein remaining = -30, target = 100 → clamps to 0 → ratio = 1.0 → emphasis fires
    const result = buildMacroGapEmphasis(
      { calories: 2000, protein: 100, carbs: 200, fat: 70 },
      { calories: 2000, protein: -30, carbs: 200, fat: 70 },
    );
    expect(result).toContain("protein");
  });

  it("returns empty string when remaining equals target (ratio = 0)", () => {
    const targets: MacroTargets = {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 70,
    };
    const remaining: MacroTargets = {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 70,
    };
    expect(buildMacroGapEmphasis(targets, remaining)).toBe("");
  });
});
