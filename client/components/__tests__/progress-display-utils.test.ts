import { describe, it, expect } from "vitest";

import {
  calculateProgressPercentage,
  calculateBorderRadius,
  getMicronutrientBarColor,
  clampPercentage,
} from "../progress-display-utils";

describe("progress-display-utils", () => {
  describe("calculateProgressPercentage", () => {
    it("returns correct percentage", () => {
      expect(calculateProgressPercentage(50, 100)).toBe(50);
    });

    it("clamps to 100 when value exceeds max", () => {
      expect(calculateProgressPercentage(150, 100)).toBe(100);
    });

    it("returns 0 for zero value", () => {
      expect(calculateProgressPercentage(0, 100)).toBe(0);
    });

    it("treats zero max as 1 to avoid division by zero", () => {
      expect(calculateProgressPercentage(50, 0)).toBe(100);
    });

    it("handles fractional values", () => {
      expect(calculateProgressPercentage(1, 3)).toBeCloseTo(33.33, 1);
    });
  });

  describe("calculateBorderRadius", () => {
    it("returns half the height for pill shape", () => {
      expect(calculateBorderRadius(8)).toBe(4);
    });

    it("works with odd heights", () => {
      expect(calculateBorderRadius(11)).toBe(5.5);
    });
  });

  describe("getMicronutrientBarColor", () => {
    it("returns green for 100% or above (met goal)", () => {
      expect(getMicronutrientBarColor(100)).toBe("#2E7D32");
      expect(getMicronutrientBarColor(150)).toBe("#2E7D32");
    });

    it("returns amber for 50-99% (halfway)", () => {
      expect(getMicronutrientBarColor(50)).toBe("#F57F17");
      expect(getMicronutrientBarColor(75)).toBe("#F57F17");
      expect(getMicronutrientBarColor(99)).toBe("#F57F17");
    });

    it("returns red for below 50% (low)", () => {
      expect(getMicronutrientBarColor(0)).toBe("#C62828");
      expect(getMicronutrientBarColor(25)).toBe("#C62828");
      expect(getMicronutrientBarColor(49)).toBe("#C62828");
    });
  });

  describe("clampPercentage", () => {
    it("returns value within range unchanged", () => {
      expect(clampPercentage(50)).toBe(50);
    });

    it("clamps values above 100 to 100", () => {
      expect(clampPercentage(150)).toBe(100);
    });

    it("clamps negative values to 0", () => {
      expect(clampPercentage(-10)).toBe(0);
    });

    it("returns 0 for zero", () => {
      expect(clampPercentage(0)).toBe(0);
    });

    it("returns 100 for exactly 100", () => {
      expect(clampPercentage(100)).toBe(100);
    });
  });
});
