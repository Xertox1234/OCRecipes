import { describe, it, expect } from "vitest";

import { calculateRemaining, calculateProgress } from "../calorie-budget-utils";

describe("calorie-budget-utils", () => {
  describe("calculateRemaining", () => {
    it("returns positive when under budget", () => {
      expect(calculateRemaining(2000, 1500)).toBe(500);
    });

    it("returns zero when exactly at budget", () => {
      expect(calculateRemaining(2000, 2000)).toBe(0);
    });

    it("returns negative when over budget", () => {
      expect(calculateRemaining(2000, 2500)).toBe(-500);
    });
  });

  describe("calculateProgress", () => {
    it("returns ratio of food to calorie goal", () => {
      expect(calculateProgress(1000, 2000)).toBe(0.5);
    });

    it("clamps to 1 when food exceeds goal", () => {
      expect(calculateProgress(3000, 2000)).toBe(1);
    });

    it("returns 0 when calorie goal is zero", () => {
      expect(calculateProgress(500, 0)).toBe(0);
    });

    it("returns 0 when calorie goal is negative", () => {
      expect(calculateProgress(500, -100)).toBe(0);
    });

    it("returns 0 when no food consumed", () => {
      expect(calculateProgress(0, 2000)).toBe(0);
    });
  });
});
