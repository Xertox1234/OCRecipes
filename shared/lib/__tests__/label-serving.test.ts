import { parseServingBasis, parseLabelServingGrams } from "../label-serving";

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

  it("prefers the parenthetical over a leading household measure", () => {
    // "1 cup (240ml)" must be 240ml, not 1 gram.
    expect(parseServingBasis("1 cup (240ml)")).toEqual({
      quantity: 240,
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
    // this one must find the same number.
    for (const s of ["1 can (355 mL)", "(198g/7oz)", "30g", "1 cup (240ml)"]) {
      expect(parseServingBasis(s)?.quantity).toBe(parseLabelServingGrams(s));
    }
  });
});
