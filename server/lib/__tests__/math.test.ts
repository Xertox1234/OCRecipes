import { describe, it, expect } from "vitest";
import { roundToOneDecimal } from "../math";

describe("roundToOneDecimal", () => {
  it("rounds down", () => {
    expect(roundToOneDecimal(1.24)).toBe(1.2);
  });

  it("rounds up", () => {
    expect(roundToOneDecimal(1.25)).toBe(1.3);
  });

  it("passes through integers", () => {
    expect(roundToOneDecimal(5)).toBe(5);
  });

  it("handles zero", () => {
    expect(roundToOneDecimal(0)).toBe(0);
  });

  it("handles negative numbers", () => {
    expect(roundToOneDecimal(-1.55)).toBe(-1.5);
  });

  it("handles already-rounded values", () => {
    expect(roundToOneDecimal(3.1)).toBe(3.1);
  });
});
