import { describe, it, expect } from "vitest";
import { labelEnergyAgrees, macroCalories } from "../label-energy";

describe("macroCalories", () => {
  it("counts 4 kcal a gram of protein and carbs, 9 of fat", () => {
    expect(macroCalories({ protein: 3, carbs: 37, fat: 8 })).toBe(232);
  });
  it("counts only the macros that were read", () => {
    expect(macroCalories({ protein: null, carbs: 37, fat: null })).toBe(148);
  });
});

describe("labelEnergyAgrees", () => {
  const granola = { protein: 3, carbs: 37, fat: 8 }; // 232 kcal

  it("agrees when the calories match the macros", () => {
    expect(labelEnergyAgrees(230, granola)).toBe(true);
  });

  it("allows the drift fibre and the label's own rounding give", () => {
    // 252 from macros against a printed 230: within a quarter.
    expect(labelEnergyAgrees(230, { protein: 5, carbs: 31, fat: 12 })).toBe(
      true,
    );
    // Small foods get a 30 kcal floor.
    expect(labelEnergyAgrees(10, { protein: 0, carbs: 9, fat: 0 })).toBe(true);
  });

  it("disagrees when a misread calorie figure is far from the macros", () => {
    // The bug report: a full label logged as 10 cal.
    expect(labelEnergyAgrees(10, granola)).toBe(false);
    expect(labelEnergyAgrees(2300, granola)).toBe(false);
  });

  it("with a macro unread, disagrees only when the rest already exceed the calories", () => {
    expect(labelEnergyAgrees(10, { protein: null, carbs: 37, fat: null })).toBe(
      false,
    );
    // Too little read to tell: the fat may be what is missing.
    expect(labelEnergyAgrees(230, { protein: 3, carbs: 37, fat: null })).toBe(
      true,
    );
    expect(
      labelEnergyAgrees(230, { protein: null, carbs: null, fat: null }),
    ).toBe(true);
  });

  it("a zero-calorie drink with no macros agrees", () => {
    expect(labelEnergyAgrees(0, { protein: 0, carbs: 0, fat: 0 })).toBe(true);
  });
});
