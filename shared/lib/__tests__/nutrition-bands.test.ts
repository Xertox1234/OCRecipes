import { describe, it, expect } from "vitest";
import {
  concernBand,
  benefitBand,
  type Basis,
  resolveBasis,
  pickStandouts,
  type NutrientBands,
  type ConcernBand,
  type BenefitBand,
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
    // itself exceeds FSA_PORTION_FOOD.lines.saturatedFat (6).
    expect(concernBand("saturatedFat", 6.1, basis, 240)).toBe("high");
  });

  it("only promotes when the portion actually exceeds 100g", () => {
    // Same product, same numbers, portion weight the only difference.
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    expect(concernBand("saturatedFat", 6.1, basis, 240)).toBe("high");
    expect(concernBand("saturatedFat", 6.1, basis, 100)).toBe("medium");
  });

  // FOOD ONLY, and no longer a general claim — read this before reusing the
  // argument on the drink scale, where it is false.
  //
  // Not tested for food, deliberately: a portion at or under 100 g that
  // exceeds the portion line but not the per-100 line is unreachable. Every
  // food portion line sits ABOVE its per-100 counterpart (satfat 6 vs 5,
  // sodium 720 vs 600, sugar 27 vs 22.5), and at a portion <= 100 g the
  // per-100 value is >= the portion value — so clearing the portion line
  // already implies clearing the per-100 line. A test there would pass for
  // the wrong reason.
  //
  // That second step is what breaks on the drink scale. The step holds only
  // because the food TRIGGER (100 g) equals the per-100 basis; the drink
  // trigger is 150 ml, so a 150 ml portion has a per-100 value of two thirds
  // the portion value, and 14 g of sugar is 9.33 g/100 ml — over the 13.5
  // portion line, under the 11.25 per-100 line. That state IS reachable, and
  // the trigger is the only thing suppressing it, so it is pinned by name
  // ("does NOT promote a drink portion at or under the 150 ml trigger")
  // rather than argued away here.

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

  it("Cherry Coke: promotes on the DRINK portion line, at the drink trigger", () => {
    // 39 g in 355 ml is 11.0 g/100 ml — under the 11.25 per-100 drink line, so
    // the per-100 arm says medium and only the portion arm can decide this.
    // 39 > 13.5 at a 355 ml portion (> the 150 ml trigger) makes it RED.
    //
    // This product is the reason to read the arithmetic and not just the
    // verdict. Before the drink table existed the code ALSO said high here,
    // via 39 > 27 — the food line applied to a drink. Right answer, wrong
    // reason. The assertion below is the same word for a different sum.
    const drinkBasis: Basis = {
      kind: "resolved",
      scale: "drink",
      factor: 100 / 355,
    };
    expect(concernBand("sugar", 39, drinkBasis, 355)).toBe("high");
  });

  it("500 ml drink at 28 g sugar promotes — the food line missed it by 1 g", () => {
    // 28 g in 500 ml is 5.6 g/100 ml, well under the per-100 drink line, so
    // again only the portion arm decides. Against the drink line it is red
    // (28 > 13.5, 500 > 150).
    //
    // Named the "invented-red case" when the food line was what fired here,
    // because 28 > 27 was arithmetic about a food. Under the published drink
    // table the red is not invented, it is required — and a 20 g bottle, which
    // the food line cleared entirely, is red now too.
    const drinkBasis: Basis = {
      kind: "resolved",
      scale: "drink",
      factor: 100 / 500,
    };
    expect(concernBand("sugar", 28, drinkBasis, 500)).toBe("high");
    expect(concernBand("sugar", 20, drinkBasis, 500)).toBe("high");
  });

  it("does NOT promote a drink portion at or under the 150 ml trigger", () => {
    // The trigger is the only thing standing between the drink portion line
    // and a 100-150 ml portion, because the food trigger of 100 would let
    // this through: 14 > 13.5 already.
    const drinkBasis: Basis = {
      kind: "resolved",
      scale: "drink",
      factor: 100 / 140,
    };
    expect(concernBand("sugar", 14, drinkBasis, 140)).toBe("medium");
    expect(concernBand("sugar", 14, drinkBasis, 150)).toBe("medium");
  });

  it("food-basis override still promotes when all conditions are met", () => {
    // Sanity check: the gate does not disable the override for food.
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    expect(concernBand("saturatedFat", 6.1, basis, 240)).toBe("high");
  });
});

/**
 * The per-portion override across both caller SHAPES.
 *
 * The first case pins the already-per-100 shape (the scan path), which the
 * override previously mis-read; it landed one commit earlier asserting
 * "medium" so the inversion is on the record. The rest pin the per-portion
 * shape (the saved-item path), whose arithmetic that same commit rewrote —
 * the portion value is now derived from per-100 instead of read straight off
 * `perServingValue` — and which had to be shown behaviour-preserving rather
 * than assumed so.
 */
describe("concernBand — per-portion override across both caller shapes", () => {
  it("applies the override to an already-per-100 (factor 1) basis", () => {
    // The SCAN PATH's shape: `validatedData.per100g` resolves to factor 1, so
    // `perServingValue` is a per-100 number, NOT a portion. The override
    // derives the portion value from it (11.0 g/100 ml across 355 ml = 39 g),
    // which is over the 13.5 drink line at a portion over 150 ml.
    //
    // Non-vacuity: this returned "medium" before the derivation landed,
    // because the raw 11.0 was compared to the portion line as though a
    // whole can held 11 g of sugar. That is the under-warning this shape
    // exists to catch, and it is the shape the nutrition panel actually uses.
    const drink: Basis = { kind: "resolved", scale: "drink", factor: 1 };
    expect(concernBand("sugar", 11.0, drink, 355)).toBe("high");
    // Same value, portion under the trigger — the override cannot reach it.
    expect(concernBand("sugar", 11.0, drink, 150)).toBe("medium");
  });

  it("food saved-item shape: saturated fat, either side of the portion line", () => {
    // `factor = 100/Q` with `portionGrams = Q` — the saved-item shape, and the
    // one the arithmetic change round-trips through.
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    expect(concernBand("saturatedFat", 6.1, basis, 240)).toBe("high");
    expect(concernBand("saturatedFat", 5.9, basis, 240)).toBe("medium");
  });

  // An earlier version of the test above avoided exactly-on-the-line values
  // ("off-the-line values, not 6.0 exactly: the new derivation is floating
  // point"), which is the wrong instinct: a threshold's boundary is the one
  // input most worth pinning, and every FSA line here is a round number that
  // real labels hit (6 g saturated fat, 27 g sugar, 720 mg sodium).
  //
  // Pinning it caught a real regression. The round trip `v * (100/Q) * Q/100`
  // returned 6.000000000000001 for v=6.0 at Q=500 and banded HIGH, where the
  // pre-change code compared 6.0 > 6 directly and said MEDIUM. It is
  // input-specific — 500 reproduces, 240 does not — so a spot check at one
  // portion size would have missed it. `portionValueOf` rounds it away.
  describe("a value exactly ON the portion line is not above it", () => {
    const foodAt = (q: number): Basis => ({
      kind: "resolved",
      scale: "food",
      factor: 100 / q,
    });
    const drinkAt = (q: number): Basis => ({
      kind: "resolved",
      scale: "drink",
      factor: 100 / q,
    });

    /**
     * The claim is "the override did not fire", NOT "the band is medium" —
     * those come apart at large portions, where the per-100 value drops under
     * the LOW line and the correct answer is `low` (6 g of saturated fat
     * spread over 1000 g is 0.6/100 g). An earlier draft of this block
     * asserted `medium` and failed for exactly that reason.
     *
     * So assert the mechanism directly: the band must equal what the SAME call
     * returns with `portionGrams` omitted, where the override cannot run at
     * all. The `not.toBe("high")` guards the equality from passing vacuously
     * if both sides ever became `high`.
     */
    const overrideDidNotFire = (
      nutrient: "sugar" | "saturatedFat" | "sodium",
      value: number,
      basis: Basis,
      q: number,
    ) => {
      expect(concernBand(nutrient, value, basis, q)).not.toBe("high");
      expect(concernBand(nutrient, value, basis, q)).toBe(
        concernBand(nutrient, value, basis),
      );
    };

    it.each([200, 240, 500, 1000])(
      "saturated fat at exactly 6 g in a %d g portion does not promote",
      (q) => overrideDidNotFire("saturatedFat", 6, foodAt(q), q),
    );

    it.each([200, 240, 500, 1000])(
      "sugar at exactly 27 g in a %d g portion does not promote",
      (q) => overrideDidNotFire("sugar", 27, foodAt(q), q),
    );

    it.each([200, 240, 500, 1000])(
      "sodium at exactly 720 mg in a %d g portion does not promote",
      (q) => overrideDidNotFire("sodium", 720, foodAt(q), q),
    );

    it.each([200, 330, 500, 1000])(
      "drink sugar at exactly 13.5 g in a %d ml portion does not promote",
      (q) => overrideDidNotFire("sugar", 13.5, drinkAt(q), q),
    );

    it("still promotes a hair ABOVE the line, so the rounding did not blunt it", () => {
      // Non-vacuity for the whole block: if `portionValueOf` rounded coarsely
      // enough to swallow a real exceedance, every assertion above would pass
      // for the wrong reason. 6.01 is finer than the label precision the
      // rounding is scoped to discard.
      expect(concernBand("saturatedFat", 6.01, foodAt(500), 500)).toBe("high");
      expect(concernBand("sugar", 27.01, foodAt(500), 500)).toBe("high");
    });

    it("agrees with the scan-path shape on the same product", () => {
      // Same portion, values expressed per-100 with factor 1 instead of
      // per-portion with factor 100/Q. The two shapes must not disagree about
      // a boundary — that divergence is what `portionValueOf` exists to close.
      const per100 = 6 / 5; // 6 g across a 500 g portion
      const scanPath: Basis = { kind: "resolved", scale: "food", factor: 1 };
      expect(concernBand("saturatedFat", per100, scanPath, 500)).toBe(
        concernBand("saturatedFat", 6, foodAt(500), 500),
      );
    });
  });

  it("food saved-item shape: sodium, either side of the portion line", () => {
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 300 };
    expect(concernBand("sodium", 721, basis, 300)).toBe("high");
    expect(concernBand("sodium", 700, basis, 300)).toBe("medium");
  });

  it("food saved-item shape: sugar, either side of the portion line", () => {
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 200 };
    expect(concernBand("sugar", 27.1, basis, 200)).toBe("high");
    expect(concernBand("sugar", 26.9, basis, 200)).toBe("medium");
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

/** Terse fixture builder. Typed, so a bad band string fails at compile time. */
const c = <B extends ConcernBand | BenefitBand>(band: B, hasValue = true) => ({
  band,
  hasValue,
});

describe("pickStandouts", () => {
  it("promotes the worst concern and the best benefit", () => {
    const bands: NutrientBands = {
      concerns: { sugar: c("high"), sodium: c("medium") },
      benefits: { fibre: c("excellent"), protein: c("good") },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "concern", nutrient: "sugar", band: "high", hasValue: true },
      {
        group: "benefit",
        nutrient: "fibre",
        band: "excellent",
        hasValue: true,
      },
    ]);
  });

  it("falls back to fibre when no benefit qualifies", () => {
    // Cherry Coke: high sugar, nothing good to say. Fibre still appears,
    // as an explicit grey NONE — its absence IS the finding.
    const bands: NutrientBands = {
      concerns: { sugar: c("high"), sodium: c("low") },
      benefits: { fibre: c("none"), protein: c("none") },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "concern", nutrient: "sugar", band: "high", hasValue: true },
      { group: "benefit", nutrient: "fibre", band: "none", hasValue: true },
    ]);
  });

  it("fills the concern slot from fixed order when no concern qualifies", () => {
    const bands: NutrientBands = {
      concerns: { sugar: c("low"), sodium: c("low") },
      benefits: { fibre: c("excellent") },
    };
    expect(pickStandouts(bands)).toEqual([
      {
        group: "benefit",
        nutrient: "fibre",
        band: "excellent",
        hasValue: true,
      },
      { group: "concern", nutrient: "sugar", band: "low", hasValue: true },
    ]);
  });

  it("promotes fibre plus the first valued concern when ALL bands are unknown", () => {
    // THE dominant saved-item state: values known, basis unresolved, so
    // every band is unknown. Rule 5 is value-presence, not band-knownness —
    // showing nothing here would blank the card on a screen whose premise is
    // surfacing data.
    const bands: NutrientBands = {
      concerns: {
        sugar: c("unknown"),
        saturatedFat: c("unknown"),
        sodium: c("unknown"),
      },
      benefits: { fibre: c("unknown"), protein: c("unknown") },
    };
    expect(pickStandouts(bands)).toEqual([
      {
        group: "benefit",
        nutrient: "fibre",
        band: "unknown",
        hasValue: true,
      },
      { group: "concern", nutrient: "sugar", band: "unknown", hasValue: true },
    ]);
  });

  it("skips a concern with no value when filling by rule 5", () => {
    const bands: NutrientBands = {
      concerns: {
        sugar: c("unknown", false), // not recorded
        sodium: c("unknown", true),
      },
      benefits: { fibre: c("unknown", true) },
    };
    expect(pickStandouts(bands)).toEqual([
      {
        group: "benefit",
        nutrient: "fibre",
        band: "unknown",
        hasValue: true,
      },
      {
        group: "concern",
        nutrient: "sodium",
        band: "unknown",
        hasValue: true,
      },
    ]);
  });

  it("breaks concern ties on fixed order — sugar wins", () => {
    const bands: NutrientBands = {
      concerns: { sodium: c("high"), sugar: c("high") },
      benefits: {},
    };
    // Full-array assertion, not just index [0]: with no fibre to fall back
    // on, the benefit slot must stay empty — this documents that shape too.
    expect(pickStandouts(bands)).toEqual([
      { group: "concern", nutrient: "sugar", band: "high", hasValue: true },
    ]);
  });

  it("breaks benefit ties on fixed order — fibre wins", () => {
    const bands: NutrientBands = {
      concerns: { sugar: c("high") },
      benefits: { protein: c("excellent"), fibre: c("excellent") },
    };
    expect(pickStandouts(bands)[1]).toEqual({
      group: "benefit",
      nutrient: "fibre",
      band: "excellent",
      hasValue: true,
    });
  });

  it("is insensitive to key insertion order", () => {
    // Determinism by PERMUTATION, not repetition. Calling a pure function
    // twice cannot differ; iterating a differently-built object can.
    const a: NutrientBands = {
      concerns: { sugar: c("medium"), sodium: c("high") },
      benefits: { fibre: c("good"), protein: c("excellent") },
    };
    const b: NutrientBands = {
      concerns: { sodium: c("high"), sugar: c("medium") },
      benefits: { protein: c("excellent"), fibre: c("good") },
    };
    expect(pickStandouts(a)).toEqual(pickStandouts(b));
  });

  it("always returns two distinct rows when two nutrients have values", () => {
    const cases: NutrientBands[] = [
      { concerns: { sugar: c("high") }, benefits: { fibre: c("excellent") } },
      { concerns: { sugar: c("low") }, benefits: { fibre: c("none") } },
      { concerns: { sugar: c("unknown") }, benefits: { fibre: c("unknown") } },
    ];
    for (const bands of cases) {
      const out = pickStandouts(bands);
      expect(out).toHaveLength(2);
      expect(out[0]).not.toEqual(out[1]);
    }
  });

  it("returns what it can when fewer than two nutrients have values", () => {
    const bands: NutrientBands = {
      concerns: { sugar: c("unknown", false) },
      benefits: { fibre: c("good", true) },
    };
    const out = pickStandouts(bands);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      group: "benefit",
      nutrient: "fibre",
      band: "good",
      hasValue: true,
    });
  });

  it("promotes a lone concern exactly AT the medium threshold", () => {
    // Pins the >= boundary on CONCERN_RANK.medium: no other concern present
    // to win "by rank" anyway, so a >= vs > mix-up would silently drop this
    // concern and let rule 5 refill it, flipping the output order.
    const bands: NutrientBands = {
      concerns: { sodium: c("medium") },
      benefits: { fibre: c("none") },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "concern", nutrient: "sodium", band: "medium", hasValue: true },
      { group: "benefit", nutrient: "fibre", band: "none", hasValue: true },
    ]);
  });

  it("promotes a lone benefit exactly AT the good threshold", () => {
    // Pins the >= boundary on BENEFIT_RANK.good: no fibre entry at all, so a
    // >= vs > mix-up drops the benefit slot entirely (rule 4 has no fibre to
    // fall back to), shrinking the result from two rows to one.
    const bands: NutrientBands = {
      concerns: { sugar: c("high") },
      benefits: { protein: c("good") },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "concern", nutrient: "sugar", band: "high", hasValue: true },
      { group: "benefit", nutrient: "protein", band: "good", hasValue: true },
    ]);
  });

  it("carries hasValue through a rule-4 fibre promotion, distinguishing a recorded value from none", () => {
    // Finding 1: Standout must not collapse "no value at all" and "value
    // present, basis unresolved" into the same shape. Same band (none) in
    // both cases below — only hasValue differs, and it must survive.
    const noValue: NutrientBands = {
      concerns: { sugar: c("high") },
      benefits: { fibre: c("none", false) },
    };
    expect(pickStandouts(noValue)).toEqual([
      { group: "concern", nutrient: "sugar", band: "high", hasValue: true },
      { group: "benefit", nutrient: "fibre", band: "none", hasValue: false },
    ]);

    const withValue: NutrientBands = {
      concerns: { sugar: c("high") },
      benefits: { fibre: c("none", true) },
    };
    expect(pickStandouts(withValue)).toEqual([
      { group: "concern", nutrient: "sugar", band: "high", hasValue: true },
      { group: "benefit", nutrient: "fibre", band: "none", hasValue: true },
    ]);
  });

  it("does not promote a never-recorded fibre when filling by rule 5", () => {
    // Finding 2: no existing test exercised the FALSE path of `fibre?.hasValue`
    // in rule 5's benefit half. A >= vs boolean-elision mutant there would
    // wrongly promote a fibre value that was never recorded.
    const bands: NutrientBands = {
      concerns: { sugar: c("unknown", true) },
      benefits: { fibre: c("unknown", false) },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "concern", nutrient: "sugar", band: "unknown", hasValue: true },
    ]);
  });
});
