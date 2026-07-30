import { describe, it, expect } from "vitest";

import { parseLabelServingGrams } from "../lib/label-serving";

describe("parseLabelServingGrams", () => {
  it("prefers the metric figure in parentheses", () => {
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
   * The whole reason this module exists. Both cases were real divergences
   * between the two `parseServingGrams` implementations the client and server
   * gates used to call independently.
   */
  describe("the divergences that motivated unifying this", () => {
    /**
     * `SERVING_SIZE_PATTERN` captures to end of line, so an OCR line break in
     * "Serving Size 355 mL" yields `"355"`. The client's parser accepted that
     * as 355 while the server's returned null — so the client gate passed (and
     * suppressed the "we couldn't use that label" notice), the label was
     * POSTed, and the server silently refused.
     *
     * A unit is now required on BOTH sides. Rejecting it is the safe answer:
     * 355 what? On "Serving Size 1" the old client parser returned 1, which
     * would scale every nutrient by 100x.
     */
    it("rejects a bare number — no unit means no serving", () => {
      expect(parseLabelServingGrams("355")).toBeNull();
      expect(parseLabelServingGrams("30")).toBeNull();
      // The dangerous one: a 1-gram serving scales nutrients by 100x.
      expect(parseLabelServingGrams("1")).toBeNull();
    });

    it("still reads a serving whose closing parenthesis was lost to OCR", () => {
      // The server's looser pattern handled this and the client's did not.
      expect(parseLabelServingGrams("355 mL)")).toBe(355);
    });
  });

  /**
   * Sodium lines sit directly beside serving lines on a real panel, and the
   * serving capture runs to end of line — so "30 mg" can land in the captured
   * string. Reading it as 30 grams would scale everything by 3.3x.
   */
  it("does not read a milligram figure as grams", () => {
    expect(parseLabelServingGrams("30 mg")).toBeNull();
    expect(parseLabelServingGrams("Sodium 30mg")).toBeNull();
  });

  it("does not pick a digit out of the middle of a longer token", () => {
    // Anchored to a token start, so an id/code fragment cannot masquerade as a
    // serving.
    expect(parseLabelServingGrams("abc123g")).toBeNull();
  });

  it("reads the real device capture from a Cherry Coke can", () => {
    // Verbatim from the Canadian bilingual panel that motivated this work.
    expect(parseLabelServingGrams("1 can (355 mL)")).toBe(355);
    expect(parseLabelServingGrams("1 canette (355 mL)")).toBe(355);
  });
});
