import { describe, it, expect } from "vitest";
import {
  concernBand,
  benefitBand,
  type Basis,
  resolveBasis,
} from "../nutrition-bands";

const FOOD: Basis = { kind: "resolved", scale: "food", factor: 1 };
const DRINK: Basis = { kind: "resolved", scale: "drink", factor: 1 };
const UNKNOWN: Basis = { kind: "unknown" };

describe("concernBand — food boundaries", () => {
  // Each threshold tested AT the value, just below, and just above.
  it.each([
    ["sugar", 4.9, "low"],
    ["sugar", 5.0, "low"], // "at or below" is LOW
    ["sugar", 5.1, "medium"],
    ["sugar", 22.5, "medium"], // "above" is HIGH, so the line itself is MEDIUM
    ["sugar", 22.6, "high"],
    ["saturatedFat", 1.5, "low"],
    ["saturatedFat", 1.6, "medium"],
    ["saturatedFat", 5.0, "medium"],
    ["saturatedFat", 5.1, "high"],
    ["fat", 3.0, "low"],
    ["fat", 3.1, "medium"],
    ["fat", 17.5, "medium"],
    ["fat", 17.6, "high"],
    ["sodium", 120, "low"],
    ["sodium", 121, "medium"],
    ["sodium", 600, "medium"],
    ["sodium", 601, "high"],
  ] as const)("%s at %d bands %s", (nutrient, value, expected) => {
    expect(concernBand(nutrient, value, FOOD)).toBe(expected);
  });
});

describe("concernBand — drink boundaries", () => {
  it.each([
    ["sugar", 2.5, "low"],
    ["sugar", 2.6, "medium"],
    ["sugar", 11.25, "medium"],
    ["sugar", 11.26, "high"],
    ["saturatedFat", 0.75, "low"],
    ["saturatedFat", 2.5, "medium"],
    ["saturatedFat", 2.6, "high"],
    ["fat", 1.5, "low"],
    ["fat", 8.75, "medium"],
    ["fat", 8.76, "high"],
    ["sodium", 120, "low"],
    ["sodium", 300, "medium"],
    ["sodium", 301, "high"],
  ] as const)("%s at %d bands %s", (nutrient, value, expected) => {
    expect(concernBand(nutrient, value, DRINK)).toBe(expected);
  });
});

describe("concernBand — the three distinct absent states", () => {
  it("bands unknown when the basis is unresolved, even with a value", () => {
    // The dominant saved-item case. A value we cannot place on a scale is
    // NOT low.
    expect(concernBand("sugar", 39, UNKNOWN)).toBe("unknown");
  });

  it("bands unknown when the value is absent", () => {
    expect(concernBand("sugar", undefined, FOOD)).toBe("unknown");
  });

  it("bands zero as LOW, distinctly from unknown", () => {
    expect(concernBand("sugar", 0, FOOD)).toBe("low");
  });
});

describe("concernBand — the factor converts per-serving to per-100", () => {
  it("bands Amy's chili sodium MEDIUM, not HIGH", () => {
    // 680mg in a 236g serving = 288mg/100g -> MEDIUM.
    // Banding the raw 680 would read HIGH. This is the defect the explicit
    // basis exists to prevent.
    const basis: Basis = {
      kind: "resolved",
      scale: "food",
      factor: 100 / 236,
    };
    expect(concernBand("sodium", 680, basis)).toBe("medium");
  });

  it("bands Cherry Coke sugar MEDIUM on the drink scale, not HIGH", () => {
    // 39g in 355ml = 11.0g/100ml, just under the 11.25 drink line.
    const basis: Basis = {
      kind: "resolved",
      scale: "drink",
      factor: 100 / 355,
    };
    expect(concernBand("sugar", 39, basis)).toBe("medium");
  });

  it("bands the same value differently on the two scales", () => {
    // Drink thresholds are roughly half the food ones, so the scale flips
    // bands on its own — this is why resolveBasis refuses to default to food.
    const drink: Basis = { kind: "resolved", scale: "drink", factor: 1 };
    const food: Basis = { kind: "resolved", scale: "food", factor: 1 };
    expect(concernBand("sugar", 20, drink)).toBe("high");
    expect(concernBand("sugar", 20, food)).toBe("medium");
  });
});

describe("concernBand — per-portion HIGH override", () => {
  it("promotes to HIGH when a >100g portion exceeds the portion line", () => {
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    // 6.1g satfat in 240g = 2.54/100g -> MEDIUM by per-100, but the portion
    // itself exceeds FSA_PORTION.saturatedFat (6).
    expect(concernBand("saturatedFat", 6.1, basis, 240)).toBe("high");
  });

  it("only promotes when the portion actually exceeds 100g", () => {
    // Same product, same numbers, portion weight the only difference.
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    expect(concernBand("saturatedFat", 6.1, basis, 240)).toBe("high");
    expect(concernBand("saturatedFat", 6.1, basis, 100)).toBe("medium");
  });

  // NOT TESTED, deliberately: a portion at or under 100g that exceeds the
  // portion line but not the per-100 line. That state is unreachable. Every
  // portion line sits ABOVE its per-100 counterpart (satfat 6 vs 5, sodium
  // 720 vs 600, sugar 27 vs 22.5), and for a portion <= 100g the per-100
  // value is >= the raw value — so exceeding the portion line already
  // implies exceeding the per-100 line. Do not write a test asserting a
  // distinction the thresholds make impossible; it would pass for the
  // wrong reason.

  it("never applies a portion override to total fat", () => {
    // FSA publishes no per-portion figure for total fat; inventing one would
    // make it our number rather than theirs.
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    // 20g fat in 240g = 8.3/100g -> MEDIUM, and stays MEDIUM.
    expect(concernBand("fat", 20, basis, 240)).toBe("medium");
  });

  it("skips the override when the portion weight is unknown", () => {
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    expect(concernBand("saturatedFat", 6.1, basis, null)).toBe("medium");
  });

  it("gating the override to food: Cherry Coke on drink scale with portion weight", () => {
    // 39g in 355ml = 11.0g/100ml, comfortably medium on the drink scale.
    // If the override leaked onto drinks, this would falsely promote to high
    // (39 > 27, the food sugar line). With the scale gate, it stays medium.
    const drinkBasis: Basis = {
      kind: "resolved",
      scale: "drink",
      factor: 100 / 355,
    };
    expect(concernBand("sugar", 39, drinkBasis, 355)).toBe("medium");
  });

  it("gating the override to food: invented-red case (5.6g/100ml drink)", () => {
    // 28g sugar in 500ml drink = 5.6g/100ml, safely medium by drink standards.
    // Without the scale gate, 28 > 27 (food line) would promote it to high.
    const drinkBasis: Basis = {
      kind: "resolved",
      scale: "drink",
      factor: 100 / 500,
    };
    expect(concernBand("sugar", 28, drinkBasis, 500)).toBe("medium");
  });

  it("food-basis override still promotes when all conditions are met", () => {
    // Sanity check: the gate does not disable the override for food.
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    expect(concernBand("saturatedFat", 6.1, basis, 240)).toBe("high");
  });
});

describe("benefitBand", () => {
  it.each([
    [2.9, "none"],
    [3.0, "good"],
    [5.9, "good"],
    [6.0, "excellent"],
  ] as const)("fibre at %dg bands %s", (value, expected) => {
    expect(benefitBand("fibre", value, FOOD)).toBe(expected);
  });

  it("bands fibre zero as none, distinctly from unknown", () => {
    expect(benefitBand("fibre", 0, FOOD)).toBe("none");
    expect(benefitBand("fibre", undefined, FOOD)).toBe("unknown");
  });

  it("bands protein by energy share", () => {
    // 11g protein x 4 = 44kcal of 200 = 22% -> excellent
    expect(benefitBand("protein", 11, FOOD, 200)).toBe("excellent");
    // 7g x 4 = 28 of 200 = 14% -> good
    expect(benefitBand("protein", 7, FOOD, 200)).toBe("good");
    // 4g x 4 = 16 of 200 = 8% -> none
    expect(benefitBand("protein", 4, FOOD, 200)).toBe("none");
  });

  it.each([
    [5.9, "none"], // 5.9 x 4 = 23.6 of 200 = 11.8% < 12% good line
    [6, "good"], // 6 x 4 = 24 of 200 = 12% = exactly the good line (inclusive)
    [9.9, "good"], // 9.9 x 4 = 39.6 of 200 = 19.8% < 20% excellent line
    [10, "excellent"], // 10 x 4 = 40 of 200 = 20% = exactly the excellent line (inclusive)
  ] as const)(
    "protein boundaries pinned: %g grams at 200 kcal bands %s",
    (grams, expected) => {
      expect(benefitBand("protein", grams, FOOD, 200)).toBe(expected);
    },
  );

  it("bands protein unknown when energy is absent or zero", () => {
    // No division by zero, and no pretending 0 kcal means 0% protein.
    expect(benefitBand("protein", 11, FOOD, undefined)).toBe("unknown");
    expect(benefitBand("protein", 11, FOOD, 0)).toBe("unknown");
  });

  it("bands unknown when the basis is unresolved", () => {
    expect(benefitBand("fibre", 12, UNKNOWN)).toBe("unknown");
  });
});

describe("resolveBasis", () => {
  it("trusts a per-100 payload with an explicit drink flag", () => {
    expect(
      resolveBasis({
        valuesArePer100: true,
        servingSize: "1 can (355 mL)",
        isBeverage: true,
      }),
    ).toEqual({ kind: "resolved", scale: "drink", factor: 1 });
  });

  it("trusts a per-100 payload with an explicit food flag", () => {
    expect(
      resolveBasis({
        valuesArePer100: true,
        servingSize: "1 cup (236g)",
        isBeverage: false,
      }),
    ).toEqual({ kind: "resolved", scale: "food", factor: 1 });
  });

  it("falls back to the serving unit when isBeverage is absent", () => {
    // The direct-OFF client fallback and older bundles have no flag.
    expect(
      resolveBasis({
        valuesArePer100: true,
        servingSize: "1 can (355 mL)",
        isBeverage: undefined,
      }),
    ).toEqual({ kind: "resolved", scale: "drink", factor: 1 });
  });

  it("back-calculates the factor from a parsed serving", () => {
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: "1 cup (236g)",
        isBeverage: null,
      }),
    ).toEqual({ kind: "resolved", scale: "food", factor: 100 / 236 });
  });

  it("prefers the explicit flag over the serving unit when both exist", () => {
    // A drink sold by weight ("500g") is still a drink.
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: "500g",
        isBeverage: true,
      }),
    ).toEqual({ kind: "resolved", scale: "drink", factor: 100 / 500 });
  });

  it("returns unknown when the serving string carries no metric quantity", () => {
    // THE saved-item case. Never a 100g default.
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: "1 bottle",
        isBeverage: undefined,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("returns unknown when the serving string is absent", () => {
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: null,
        isBeverage: undefined,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("returns unknown for a zero or negative quantity", () => {
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: "0 ml",
        isBeverage: true,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("returns unknown when a per-100 payload has no usable scale signal", () => {
    // Values are trustworthy but we cannot tell food from drink, and the
    // scales differ by ~2x. Guessing food would halve the strictness on
    // every untagged drink.
    expect(
      resolveBasis({
        valuesArePer100: true,
        servingSize: "1 serving",
        isBeverage: undefined,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("never defaults to the food scale", () => {
    const results = [
      resolveBasis({
        valuesArePer100: true,
        servingSize: null,
        isBeverage: null,
      }),
      resolveBasis({
        valuesArePer100: false,
        servingSize: "1 pack",
        isBeverage: null,
      }),
    ];
    for (const r of results) expect(r.kind).toBe("unknown");
  });
});
