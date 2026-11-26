import { describe, it, expect } from "vitest";
import {
  labelEnergyAgrees,
  looksLikeKilojoules,
  macroCalories,
} from "../label-energy";

describe("macroCalories", () => {
  it("counts 4 kcal a gram of protein and carbs, 9 of fat", () => {
    expect(macroCalories({ protein: 3, carbs: 37, fat: 8 })).toBe(232);
  });
  it("counts only the macros that were read", () => {
    expect(macroCalories({ protein: null, carbs: 37, fat: null })).toBe(148);
  });
});

describe("labelEnergyAgrees", () => {
  const granola = { protein: 3, carbs: 37, fat: 8, fibre: 4 }; // 232 kcal

  it("agrees when the calories match the macros", () => {
    expect(labelEnergyAgrees(230, granola)).toBe(true);
  });

  // The owner's report: a whole label logged as 10 cal.
  it("refuses calories far below what the macros make", () => {
    expect(labelEnergyAgrees(10, granola)).toBe(false);
    // A dropped digit.
    expect(labelEnergyAgrees(23, granola)).toBe(false);
    // Fibre not read (the phone's /label body has none): still caught.
    expect(labelEnergyAgrees(10, { ...granola, fibre: null })).toBe(false);
  });

  it("refuses calories far above what the macros could make", () => {
    // An extra digit, and kilojoules read as calories (230 kcal ≈ 970 kJ).
    expect(labelEnergyAgrees(2300, granola)).toBe(false);
    expect(labelEnergyAgrees(970, granola)).toBe(false);
  });

  // Nutrition review: real labels whose carbs make less than 4 kcal a gram
  // (fibre, sugar alcohols), or whose energy is partly alcohol.
  it.each([
    // [what, kcal, protein, carbs, fat, fibre]
    ["a fibre cereal", 60, 2, 25, 1, 14],
    ["a bran cereal, fibre unread", 80, 4, 24, 1, null],
    ["a protein bar with fibre", 190, 21, 21, 8, 14],
    ["a keto bar with sugar alcohols", 200, 20, 25, 8, 3],
    ["a beer", 153, 1.6, 13, 0, 0],
    ["a light beer", 100, 1, 3, 0, 0],
    ["a hard seltzer", 100, 0, 2, 0, 0],
    ["spirits", 97, 0, 0, 0, 0],
    ["diet soda", 0, 0, 0, 0, 0],
    ["black coffee", 5, 0.3, 0, 0, 0],
    ["a label rounding small values", 10, 0, 9, 0, 0],
    ["peanut butter", 190, 7, 8, 16, 2],
  ])("accepts %s", (_what, kcal, protein, carbs, fat, fibre) => {
    expect(labelEnergyAgrees(kcal, { protein, carbs, fat, fibre })).toBe(true);
  });

  it("with a macro unread, refuses only calories below what the rest make", () => {
    expect(
      labelEnergyAgrees(10, {
        protein: null,
        carbs: null,
        fat: 8,
        fibre: null,
      }),
    ).toBe(false);
    // The missing one may make up the rest, and there is no ceiling to check.
    expect(
      labelEnergyAgrees(900, { protein: 3, carbs: 37, fat: null, fibre: 4 }),
    ).toBe(true);
    expect(
      labelEnergyAgrees(230, {
        protein: null,
        carbs: null,
        fat: null,
        fibre: null,
      }),
    ).toBe(true);
  });
  it("without the alcohol room, refuses calories well above the macros", () => {
    // A fat of 12 g misread as 2 g: 250 kcal against 162 from the macros.
    const misread = { protein: 5, carbs: 31, fat: 2, fibre: null };
    expect(labelEnergyAgrees(250, misread)).toBe(true);
    expect(labelEnergyAgrees(250, misread, { alcohol: false })).toBe(false);
    // The low side is the same either way.
    expect(
      labelEnergyAgrees(
        60,
        { protein: 2, carbs: 25, fat: 1, fibre: 14 },
        { alcohol: false },
      ),
    ).toBe(true);
  });
});

describe("looksLikeKilojoules", () => {
  it("spots kilojoules read as calories", () => {
    expect(looksLikeKilojoules(970, { protein: 3, carbs: 37, fat: 8 })).toBe(
      true,
    );
    expect(looksLikeKilojoules(2300, { protein: 3, carbs: 37, fat: 8 })).toBe(
      false,
    );
    expect(looksLikeKilojoules(0, { protein: 0, carbs: 0, fat: 0 })).toBe(
      false,
    );
  });
});
