import { describe, it, expect } from "vitest";

import { parseLabelServingGrams } from "../lib/label-serving";

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
