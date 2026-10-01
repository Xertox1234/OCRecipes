import { describe, it, expect } from "vitest";
import { buildMacroGapEmphasis } from "../macro-gap-context";
import type { MacroTargets } from "../macro-gap-context";

// `remaining` is what the user still has left to eat today (the route passes
// remainingBudget = target − consumed). A macro LAGS when the user has eaten a
// smaller share of it than of their calories: lag = calorieShare − macroShare.
const TARGETS: MacroTargets = {
  calories: 2000,
  protein: 150,
  carbs: 250,
  fat: 70,
};

// Half the day's calories eaten, and half of every macro: nothing lags.
const ON_PACE: MacroTargets = {
  calories: 1000,
  protein: 75,
  carbs: 125,
  fat: 35,
};

describe("buildMacroGapEmphasis", () => {
  it("returns empty string when nothing has been eaten yet (breakfast)", () => {
    expect(buildMacroGapEmphasis(TARGETS, TARGETS)).toBe("");
  });

  it("returns empty string when everything has been eaten", () => {
    const nothingLeft: MacroTargets = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    };
    expect(buildMacroGapEmphasis(TARGETS, nothingLeft)).toBe("");
  });

  it("returns empty string when every macro keeps pace with calories", () => {
    expect(buildMacroGapEmphasis(TARGETS, ON_PACE)).toBe("");
  });

  it("names protein when it lags calories, reporting the protein still left", () => {
    // Calories 50% eaten; protein 10% eaten (15 of 150 g) → lag 0.40.
    const result = buildMacroGapEmphasis(TARGETS, { ...ON_PACE, protein: 135 });
    expect(result).toBe(
      "IMPORTANT: The user is 135g short on protein today — prioritize protein-dense options (≥30g protein per suggestion).",
    );
  });

  it("names carbs when they lag calories", () => {
    // Calories 50% eaten; carbs 10% eaten (25 of 250 g) → lag 0.40.
    const result = buildMacroGapEmphasis(TARGETS, { ...ON_PACE, carbs: 225 });
    expect(result).toContain("225g short on carbs");
    expect(result).toContain("≥40g carbs per suggestion");
  });

  it("names fat when it lags calories", () => {
    // Calories 50% eaten; fat 10% eaten (7 of 70 g) → lag 0.40.
    const result = buildMacroGapEmphasis(TARGETS, { ...ON_PACE, fat: 63 });
    expect(result).toContain("63g short on fat");
    expect(result).toContain("≥15g fat per suggestion");
  });

  it("never emphasises calories, even when calories lag every macro", () => {
    // Calories 10% eaten; every macro fully eaten — calories are the
    // reference, not a candidate, so no calorie-dense push.
    const result = buildMacroGapEmphasis(TARGETS, {
      calories: 1800,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    expect(result).toBe("");
  });

  it("does not name a macro the user has eaten MORE of than calories", () => {
    // Regression for the inverted formula: protein 80% eaten while calories
    // are 30% eaten is protein running AHEAD, not short.
    const result = buildMacroGapEmphasis(TARGETS, {
      calories: 1400,
      protein: 30,
      carbs: 175,
      fat: 49,
    });
    expect(result).toBe("");
  });

  it("returns empty string at a lag of exactly 0.30 (threshold is strict >)", () => {
    // Calories 50% eaten; protein 20% eaten (30 of 150 g) → lag 0.30.
    expect(buildMacroGapEmphasis(TARGETS, { ...ON_PACE, protein: 120 })).toBe(
      "",
    );
  });

  it("fires just above the threshold", () => {
    // Calories 50% eaten; protein 18% eaten (27 of 150 g) → lag 0.32.
    expect(
      buildMacroGapEmphasis(TARGETS, { ...ON_PACE, protein: 123 }),
    ).toContain("protein");
  });

  it("picks the macro with the largest lag when several lag", () => {
    // Calories 80% eaten. Protein 40% eaten → lag 0.40; fat 20% eaten → lag 0.60.
    const result = buildMacroGapEmphasis(TARGETS, {
      calories: 400,
      protein: 90,
      carbs: 50,
      fat: 56,
    });
    expect(result).toContain("fat");
    expect(result).not.toContain("protein");
  });

  it("on an exact lag tie keeps the earlier macro (strict >, first-wins)", () => {
    // Calories 50% eaten; protein and carbs both 0% eaten → both lag 0.50.
    // Iteration order is protein → carbs, so protein wins.
    const result = buildMacroGapEmphasis(TARGETS, {
      ...ON_PACE,
      protein: 150,
      carbs: 250,
    });
    expect(result).toContain("protein");
    expect(result).not.toContain("carbs");
  });

  it("returns empty string when the calorie target is zero or negative", () => {
    // No calorie target means no day progress to compare against.
    const lagging = { ...ON_PACE, protein: 150 };
    expect(buildMacroGapEmphasis({ ...TARGETS, calories: 0 }, lagging)).toBe(
      "",
    );
    // Without the guard, a negative target clamps remaining to 0 and reads
    // as "all calories eaten", which would make protein lag by 1.0.
    expect(
      buildMacroGapEmphasis({ ...TARGETS, calories: -2000 }, lagging),
    ).toBe("");
  });

  it("never names a macro with a zero or negative target", () => {
    // Calories 50% eaten. A zero target gives a NaN share and a negative one
    // clamps to "all eaten" — neither can lag, so neither may fire.
    expect(buildMacroGapEmphasis({ ...TARGETS, protein: 0 }, ON_PACE)).toBe("");
    expect(buildMacroGapEmphasis({ ...TARGETS, protein: -150 }, ON_PACE)).toBe(
      "",
    );
  });

  it("clamps a remaining amount above target to 'nothing eaten'", () => {
    // Protein remaining 300 > target 150 → clamps to 150 (0% eaten), so it
    // lags calories by 0.50, and the report says 150g, not 300g.
    const result = buildMacroGapEmphasis(TARGETS, { ...ON_PACE, protein: 300 });
    expect(result).toContain("150g short on protein");
  });

  it("clamps negative remaining calories to 'all eaten'", () => {
    // Calories remaining -500 (over budget) → 100% eaten; protein 50% eaten
    // → lag 0.50.
    const result = buildMacroGapEmphasis(TARGETS, {
      calories: -500,
      protein: 75,
      carbs: 0,
      fat: 0,
    });
    expect(result).toContain("75g short on protein");
  });

  it("rounds the reported amount to a whole number", () => {
    // Calories 50% eaten; protein remaining 134.6 g → reported as 135g.
    const result = buildMacroGapEmphasis(TARGETS, {
      ...ON_PACE,
      protein: 134.6,
    });
    expect(result).toContain("135g short on protein");
  });
});
