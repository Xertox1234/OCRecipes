import { describe, it, expect } from "vitest";
import {
  calculateDiff,
  formatDiffLabel,
  formatWeightTrend,
} from "../adaptive-goal-card-utils";

describe("calculateDiff", () => {
  it("returns positive diff for increase", () => {
    const result = calculateDiff(2000, 2200);
    expect(result.diff).toBe(200);
    expect(result.isIncrease).toBe(true);
  });

  it("returns negative diff for decrease", () => {
    const result = calculateDiff(2000, 1800);
    expect(result.diff).toBe(-200);
    expect(result.isIncrease).toBe(false);
  });

  it("returns zero diff for no change", () => {
    const result = calculateDiff(2000, 2000);
    expect(result.diff).toBe(0);
    expect(result.isIncrease).toBe(false);
  });
});

describe("formatDiffLabel", () => {
  it("formats positive diff with plus sign", () => {
    expect(formatDiffLabel(200)).toBe("+200");
  });

  it("formats negative diff without extra sign", () => {
    expect(formatDiffLabel(-200)).toBe("-200");
  });

  it("formats zero diff", () => {
    expect(formatDiffLabel(0)).toBe("0");
  });
});

describe("formatWeightTrend", () => {
  it("formats positive rate with plus sign (metric by default)", () => {
    expect(formatWeightTrend(0.5)).toBe("+0.5 kg/week");
  });

  it("formats negative rate", () => {
    expect(formatWeightTrend(-0.3)).toBe("-0.3 kg/week");
  });

  it("formats zero rate", () => {
    expect(formatWeightTrend(0)).toBe("0.0 kg/week");
  });

  it("converts the kg rate to lbs when unit is imperial", () => {
    // 0.5 kg/week → ~1.1 lbs/week
    expect(formatWeightTrend(0.5, "imperial")).toBe("+1.1 lbs/week");
  });
});
