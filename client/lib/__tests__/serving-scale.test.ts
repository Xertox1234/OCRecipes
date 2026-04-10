import { parseFraction } from "../serving-scale";

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
