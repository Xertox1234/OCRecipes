import { describe, it, expect } from "vitest";
import { bootstrapMeanCI, mulberry32 } from "../lib/runner-core";

describe("mulberry32", () => {
  it("returns values in [0, 1)", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for the same seed", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("produces different sequences for different seeds", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(99);
    const v1 = rng1();
    const v2 = rng2();
    expect(v1).not.toBe(v2);
  });
});

describe("bootstrapMeanCI", () => {
  it("returns {mean:0, lower:0, upper:0} for empty array", () => {
    const result = bootstrapMeanCI([]);
    expect(result).toEqual({ mean: 0, lower: 0, upper: 0 });
  });

  it("collapses interval to [mean, mean] for single value", () => {
    const result = bootstrapMeanCI([7]);
    expect(result.mean).toBe(7);
    expect(result.lower).toBe(7);
    expect(result.upper).toBe(7);
  });

  it("returns mean within [lower, upper] for multi-value arrays", () => {
    const values = [5, 6, 7, 8, 9];
    const result = bootstrapMeanCI(values);
    expect(result.mean).toBe(7);
    expect(result.lower).toBeLessThanOrEqual(result.mean);
    expect(result.upper).toBeGreaterThanOrEqual(result.mean);
  });

  it("is deterministic (same seed)", () => {
    const values = [4, 5, 6, 7, 8, 9, 10];
    const r1 = bootstrapMeanCI(values);
    const r2 = bootstrapMeanCI(values);
    expect(r1.lower).toBe(r2.lower);
    expect(r1.upper).toBe(r2.upper);
  });

  it("produces a wider CI for higher-variance data", () => {
    const tight = bootstrapMeanCI([5, 5, 5, 5, 5, 5, 5, 5]);
    const wide = bootstrapMeanCI([1, 2, 3, 4, 6, 7, 8, 9]);
    const tightWidth = tight.upper - tight.lower;
    const wideWidth = wide.upper - wide.lower;
    expect(wideWidth).toBeGreaterThan(tightWidth);
  });
});
