import {
  parseFraction,
  formatAsFraction,
  scaleIngredientQuantity,
} from "../serving-scale";

describe("parseFraction", () => {
  it("parses whole numbers", () => {
    expect(parseFraction("2")).toBe(2);
    expect(parseFraction("10")).toBe(10);
  });

  it("parses decimal strings", () => {
    expect(parseFraction("0.5")).toBe(0.5);
    expect(parseFraction("1.25")).toBe(1.25);
  });

  it("parses simple fractions", () => {
    expect(parseFraction("1/2")).toBeCloseTo(0.5);
    expect(parseFraction("1/3")).toBeCloseTo(0.333, 2);
    expect(parseFraction("3/4")).toBeCloseTo(0.75);
    expect(parseFraction("1/8")).toBeCloseTo(0.125);
  });

  it("parses mixed fractions", () => {
    expect(parseFraction("1 1/2")).toBeCloseTo(1.5);
    expect(parseFraction("2 1/4")).toBeCloseTo(2.25);
    expect(parseFraction("3 3/4")).toBeCloseTo(3.75);
  });

  it("returns null for non-numeric strings", () => {
    expect(parseFraction("to taste")).toBeNull();
    expect(parseFraction("a pinch")).toBeNull();
    expect(parseFraction("")).toBeNull();
    expect(parseFraction("some")).toBeNull();
  });

  it("handles whitespace", () => {
    expect(parseFraction(" 2 ")).toBe(2);
    expect(parseFraction(" 1/2 ")).toBeCloseTo(0.5);
  });
});

describe("formatAsFraction", () => {
  it("formats whole numbers without fraction", () => {
    expect(formatAsFraction(4)).toBe("4");
    expect(formatAsFraction(1)).toBe("1");
    expect(formatAsFraction(10)).toBe("10");
  });

  it("formats common halves", () => {
    expect(formatAsFraction(0.5)).toBe("1/2");
    expect(formatAsFraction(1.5)).toBe("1 1/2");
    expect(formatAsFraction(2.5)).toBe("2 1/2");
  });

  it("formats common thirds", () => {
    expect(formatAsFraction(1 / 3)).toBe("1/3");
    expect(formatAsFraction(2 / 3)).toBe("2/3");
    expect(formatAsFraction(1 + 1 / 3)).toBe("1 1/3");
  });

  it("formats common quarters", () => {
    expect(formatAsFraction(0.25)).toBe("1/4");
    expect(formatAsFraction(0.75)).toBe("3/4");
    expect(formatAsFraction(2.25)).toBe("2 1/4");
  });

  it("formats eighths", () => {
    expect(formatAsFraction(0.125)).toBe("1/8");
    expect(formatAsFraction(3.125)).toBe("3 1/8");
  });

  it("falls back to 1 decimal for uncommon fractions", () => {
    expect(formatAsFraction(1.67)).toBe("1.7");
    expect(formatAsFraction(0.6)).toBe("0.6");
  });

  it("handles zero", () => {
    expect(formatAsFraction(0)).toBe("0");
  });

  it("snaps values very close to a whole number", () => {
    expect(formatAsFraction(2.999)).toBe("3");
    expect(formatAsFraction(4.998)).toBe("5");
  });
});

describe("scaleIngredientQuantity", () => {
  it("scales a whole number string", () => {
    expect(scaleIngredientQuantity("500", 2)).toEqual({
      scaled: "1000",
      isNumeric: true,
    });
  });

  it("scales a fraction string", () => {
    expect(scaleIngredientQuantity("1/2", 2)).toEqual({
      scaled: "1",
      isNumeric: true,
    });
  });

  it("scales a mixed fraction", () => {
    expect(scaleIngredientQuantity("1 1/2", 2)).toEqual({
      scaled: "3",
      isNumeric: true,
    });
  });

  it("handles ratio 1 (no change)", () => {
    expect(scaleIngredientQuantity("2", 1)).toEqual({
      scaled: "2",
      isNumeric: true,
    });
  });

  it("handles halving (ratio 0.5)", () => {
    expect(scaleIngredientQuantity("4", 0.5)).toEqual({
      scaled: "2",
      isNumeric: true,
    });
  });

  it("produces fractions when scaling creates them", () => {
    expect(scaleIngredientQuantity("1", 1.5)).toEqual({
      scaled: "1 1/2",
      isNumeric: true,
    });
  });

  it("handles number type input", () => {
    expect(scaleIngredientQuantity(4, 2)).toEqual({
      scaled: "8",
      isNumeric: true,
    });
  });

  it("returns isNumeric false for non-numeric strings", () => {
    expect(scaleIngredientQuantity("to taste", 2)).toEqual({
      scaled: null,
      isNumeric: false,
    });
    expect(scaleIngredientQuantity("a pinch", 3)).toEqual({
      scaled: null,
      isNumeric: false,
    });
  });

  it("returns isNumeric false for null/undefined", () => {
    expect(scaleIngredientQuantity(null, 2)).toEqual({
      scaled: null,
      isNumeric: false,
    });
    expect(scaleIngredientQuantity(undefined, 2)).toEqual({
      scaled: null,
      isNumeric: false,
    });
  });

  it("returns isNumeric false for empty string", () => {
    expect(scaleIngredientQuantity("", 2)).toEqual({
      scaled: null,
      isNumeric: false,
    });
  });
});
