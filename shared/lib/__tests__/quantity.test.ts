import { describe, it, expect } from "vitest";
import { normalizeQuantityToDecimal } from "../quantity";

describe("normalizeQuantityToDecimal", () => {
  it("returns plain integers unchanged", () => {
    expect(normalizeQuantityToDecimal("2")).toBe("2");
  });

  it("returns plain decimals unchanged", () => {
    expect(normalizeQuantityToDecimal("1.5")).toBe("1.5");
  });

  it("converts a simple fraction to decimal", () => {
    expect(normalizeQuantityToDecimal("1/2")).toBe("0.5");
  });

  it("converts a mixed number to decimal", () => {
    expect(normalizeQuantityToDecimal("1 1/2")).toBe("1.5");
  });

  it("converts a bare unicode fraction glyph to decimal", () => {
    expect(normalizeQuantityToDecimal("½")).toBe("0.5");
  });

  it("converts a mixed unicode fraction to decimal", () => {
    expect(normalizeQuantityToDecimal("1½")).toBe("1.5");
  });

  it("returns null for freeform text", () => {
    expect(normalizeQuantityToDecimal("a pinch")).toBeNull();
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(normalizeQuantityToDecimal("")).toBeNull();
    expect(normalizeQuantityToDecimal("   ")).toBeNull();
  });

  it("returns null for a zero-denominator fraction", () => {
    expect(normalizeQuantityToDecimal("1/0")).toBeNull();
  });

  it("trims surrounding whitespace before matching", () => {
    expect(normalizeQuantityToDecimal("  1/2  ")).toBe("0.5");
  });
});
