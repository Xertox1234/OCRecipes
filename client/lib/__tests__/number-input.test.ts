import { parseDecimalInput, isPartialDecimal } from "../number-input";

describe("parseDecimalInput", () => {
  it.each([
    ["1.5", 1.5],
    ["1,5", 1.5],
    [" 2 ", 2],
    ["1.", 1],
    ["1,", 1],
    [".5", 0.5],
    ["", null],
    [".", null],
    ["abc", null],
    ["1,5,2", null],
    ["1.2.3", null],
  ])("parseDecimalInput(%j) → %j", (input, out) =>
    expect(parseDecimalInput(input)).toBe(out),
  );
});

describe("isPartialDecimal", () => {
  it.each(["", "1.", "1,", "."])("isPartialDecimal(%j) is true", (t) =>
    expect(isPartialDecimal(t)).toBe(true),
  );
  it.each(["1.5", "abc"])("isPartialDecimal(%j) is false", (t) =>
    expect(isPartialDecimal(t)).toBe(false),
  );
});
