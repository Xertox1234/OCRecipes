import { parseDecimalInput } from "../number-input";

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
