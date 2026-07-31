import { describe, it, expect } from "vitest";

import { parseServingBasis, parseLabelServingGrams } from "../label-serving";

/**
 * Hard forms that test the regex invariants: each one exercised against both
 * parsers to prevent drift. `parseLabelServingGrams` returns just the quantity;
 * `parseServingBasis` returns quantity + unit. Agreement means both extract
 * the same quantity, and both reject when appropriate.
 */
const HARD_FORMS = [
  { input: "1 can (355 mL)", expectedQuantity: 355, expectedUnit: "ml" },
  { input: "(198g/7oz)", expectedQuantity: 198, expectedUnit: "g" },
  { input: "30g", expectedQuantity: 30, expectedUnit: "g" },
  { input: "250 grams", expectedQuantity: 250, expectedUnit: "g" },
  { input: "355 millilitres", expectedQuantity: 355, expectedUnit: "ml" },
  { input: "1 cup (240ml)", expectedQuantity: 240, expectedUnit: "ml" },
  // Dual-unit parenthetical
  { input: "1 package (198g/7oz)", expectedQuantity: 198, expectedUnit: "g" },
  { input: "1 slice (43g/1.5oz)", expectedQuantity: 43, expectedUnit: "g" },
  {
    input: "1 tasse (250 mL/8 fl oz)",
    expectedQuantity: 250,
    expectedUnit: "ml",
  },
  // OCR spacing
  { input: "1 can (355 mL )", expectedQuantity: 355, expectedUnit: "ml" },
  // Spelled-out units
  { input: "250 millilitres", expectedQuantity: 250, expectedUnit: "ml" },
  {
    input: "250 milliliters",
    expectedQuantity: 250,
    expectedUnit: "ml",
  },
  { input: "1 gram", expectedQuantity: 1, expectedUnit: "g" },
  { input: "236.0 g", expectedQuantity: 236, expectedUnit: "g" },
  // Real device capture
  { input: "1 canette (355 mL)", expectedQuantity: 355, expectedUnit: "ml" },
];

/**
 * Forms where both parsers must agree on REJECTION. Absence of a metric unit,
 * ambiguity, or a unit that is only a prefix of a longer word.
 */
const REJECTION_FORMS = [
  "1 bottle", // household measure only
  "1 serving", // household measure only
  "355", // bare number, no unit
  "30", // bare number, no unit
  "1", // bare number, no unit — the dangerous one
  "1 gal", // unit is a prefix of "gallon"
  "2 gallons", // not "gal" or "ml"
  "30 mg", // milligram, not gram
  "Sodium 30mg", // sodium line, not serving
  "abc123g", // digit in the middle of a longer token
];

describe("parseLabelServingGrams", () => {
  it("prefers the metric figure in parentheses over the household measure", () => {
    // Taking the leading "1" would yield a 1-gram serving and scale every
    // nutrient by 100x.
    expect(parseLabelServingGrams("1 can (355 mL)")).toBe(355);
    expect(parseLabelServingGrams("2/3 cup (55 g)")).toBe(55);
    expect(parseLabelServingGrams("2 tbsp (32g)")).toBe(32);
  });

  it("accepts a bare metric serving", () => {
    expect(parseLabelServingGrams("355 mL")).toBe(355);
    expect(parseLabelServingGrams("30g")).toBe(30);
    expect(parseLabelServingGrams("236.0 g")).toBe(236);
  });

  it("is case-insensitive on the unit", () => {
    expect(parseLabelServingGrams("355 ML")).toBe(355);
    expect(parseLabelServingGrams("30G")).toBe(30);
  });

  it("returns null when no unit is present", () => {
    expect(parseLabelServingGrams("1 can")).toBeNull();
    expect(parseLabelServingGrams("1 bottle")).toBeNull();
  });

  it("returns null for empty and nullish input", () => {
    expect(parseLabelServingGrams("")).toBeNull();
    expect(parseLabelServingGrams(null)).toBeNull();
    expect(parseLabelServingGrams(undefined)).toBeNull();
  });

  /**
   * This gate decides whether a label is used at all, so it must be AT LEAST
   * as permissive as the two parsers it replaced. Narrowing it rejects labels
   * that used to work and tells the user "we couldn't find nutrition values on
   * that photo" when the calories and serving were both read perfectly.
   *
   * Every case here is one the previous server parser accepted and an earlier
   * version of this module dropped.
   */
  describe("regression: forms the predecessors accepted", () => {
    it("reads a dual-unit parenthetical", () => {
      // The closing paren does not follow the metric unit — an imperial
      // equivalent sits between them. Extremely common on North American packs.
      expect(parseLabelServingGrams("1 package (198g/7oz)")).toBe(198);
      expect(parseLabelServingGrams("1 slice (43g/1.5oz)")).toBe(43);
      expect(parseLabelServingGrams("1 tasse (250 mL/8 fl oz)")).toBe(250);
    });

    it("tolerates OCR spacing before the closing paren", () => {
      expect(parseLabelServingGrams("1 can (355 mL )")).toBe(355);
    });

    it("reads a spelled-out unit", () => {
      expect(parseLabelServingGrams("250 grams")).toBe(250);
      expect(parseLabelServingGrams("1 gram")).toBe(1);
      expect(parseLabelServingGrams("250 millilitres")).toBe(250);
      expect(parseLabelServingGrams("250 milliliters")).toBe(250);
    });
  });

  /**
   * The divergence that motivated unifying the two gates: the client parser
   * accepted a bare number, the server's did not. `SERVING_SIZE_PATTERN`
   * captures to end of line, so an OCR line break in "Serving Size 355 mL"
   * yields `"355"` — which passed the client gate (suppressing the "we
   * couldn't use that label" notice), was POSTed, and was then refused.
   */
  describe("regression: the client/server divergence", () => {
    it("rejects a bare number — no unit means no serving", () => {
      // 355 what? Ambiguity fails closed, so the caller tells the user the
      // label was unusable instead of scaling by a guess.
      expect(parseLabelServingGrams("355")).toBeNull();
      expect(parseLabelServingGrams("30")).toBeNull();
      // The dangerous one: a 1-gram serving scales nutrients by 100x.
      expect(parseLabelServingGrams("1")).toBeNull();
    });
  });

  /**
   * The unit must be a whole word. Note this is NOT about "30 mg" — neither
   * predecessor ever matched that, since `mg` is neither `g` nor `ml`. The
   * real case is a unit that is a genuine PREFIX of a longer word.
   */
  it("rejects a unit that is only a prefix of a longer word", () => {
    expect(parseLabelServingGrams("1 gal")).toBeNull();
    expect(parseLabelServingGrams("2 gallons")).toBeNull();
  });

  it("does not read a milligram figure as grams", () => {
    // True of both predecessors as well — pinned because sodium lines sit
    // directly beside serving lines and the serving capture runs to end of line.
    expect(parseLabelServingGrams("30 mg")).toBeNull();
    expect(parseLabelServingGrams("Sodium 30mg")).toBeNull();
  });

  it("does not pick a digit out of the middle of a longer token", () => {
    expect(parseLabelServingGrams("abc123g")).toBeNull();
  });

  it("reads the real device capture from a Cherry Coke can", () => {
    // Verbatim from the Canadian bilingual panel that motivated this work.
    expect(parseLabelServingGrams("1 can (355 mL)")).toBe(355);
    expect(parseLabelServingGrams("1 canette (355 mL)")).toBe(355);
  });
});

describe("parseServingBasis", () => {
  it("reads a parenthetical millilitre serving as a drink basis", () => {
    expect(parseServingBasis("1 can (355 mL)")).toEqual({
      quantity: 355,
      unit: "ml",
    });
  });

  it("reads a dual-unit gram serving as a food basis", () => {
    expect(parseServingBasis("(198g/7oz)")).toEqual({
      quantity: 198,
      unit: "g",
    });
  });

  it("reads a bare metric serving", () => {
    expect(parseServingBasis("30g")).toEqual({ quantity: 30, unit: "g" });
    expect(parseServingBasis("250 grams")).toEqual({
      quantity: 250,
      unit: "g",
    });
    expect(parseServingBasis("355 millilitres")).toEqual({
      quantity: 355,
      unit: "ml",
    });
  });

  it("prefers metric in parentheses over a leading metric bare quantity", () => {
    // A metric quantity outside the parens (e.g. "500g bag") comes before one
    // inside. With PAREN_BASIS-first preference, the inside one wins and we
    // read the unit correctly. Without it, the bare regex reads the outside one.
    // Real example: "500g bag (250 ml)" must be 250 ml, not 500 g.
    expect(parseServingBasis("500g bag (250 ml)")).toEqual({
      quantity: 250,
      unit: "ml",
    });
  });

  it("returns null for a household measure with no metric quantity", () => {
    expect(parseServingBasis("1 bottle")).toBeNull();
    expect(parseServingBasis("1 serving")).toBeNull();
  });

  it("returns null for a non-positive quantity", () => {
    // A zero basis would divide to Infinity. This is the case `|| 100`
    // silently swallowed.
    expect(parseServingBasis("0 ml")).toBeNull();
    expect(parseServingBasis("0g")).toBeNull();
  });

  it("returns null for absent input", () => {
    expect(parseServingBasis(null)).toBeNull();
    expect(parseServingBasis(undefined)).toBeNull();
    expect(parseServingBasis("")).toBeNull();
  });

  it("does not read a longer unit word as a metric unit", () => {
    // "1 gal" must not read as 1 gram — the \b guard.
    expect(parseServingBasis("1 gal")).toBeNull();
  });

  it("agrees with parseLabelServingGrams on quantity for every shared form", () => {
    // The two parsers must not drift. Where the gate parser finds a number,
    // this one must find the same number and unit.
    for (const form of HARD_FORMS) {
      const basis = parseServingBasis(form.input);
      const grams = parseLabelServingGrams(form.input);
      expect(basis?.quantity).toBe(grams);
    }
  });

  it("agrees with parseLabelServingGrams on rejection for forms both should refuse", () => {
    // Agreement includes agreeing on rejection. Both parsers must return null
    // (or in basis's case, `null`) for the same forms.
    for (const form of REJECTION_FORMS) {
      const basis = parseServingBasis(form);
      const grams = parseLabelServingGrams(form);
      expect(basis).toBeNull();
      expect(grams).toBeNull();
    }
  });
});
