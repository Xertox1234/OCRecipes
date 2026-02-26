import { describe, it, expect } from "vitest";
import {
  VITAMIN_NAMES,
  classifyMicronutrients,
  countMetGoal,
  countLow,
} from "../micronutrient-summary-utils";

describe("VITAMIN_NAMES", () => {
  it("contains all standard vitamins", () => {
    expect(VITAMIN_NAMES.has("Vitamin A")).toBe(true);
    expect(VITAMIN_NAMES.has("Vitamin C")).toBe(true);
    expect(VITAMIN_NAMES.has("Vitamin D")).toBe(true);
    expect(VITAMIN_NAMES.has("Folate")).toBe(true);
    expect(VITAMIN_NAMES.has("Vitamin B12")).toBe(true);
  });

  it("does not contain minerals", () => {
    expect(VITAMIN_NAMES.has("Iron")).toBe(false);
    expect(VITAMIN_NAMES.has("Calcium")).toBe(false);
    expect(VITAMIN_NAMES.has("Zinc")).toBe(false);
  });
});

describe("classifyMicronutrients", () => {
  const nutrients = [
    { nutrientName: "Vitamin A", percentDailyValue: 80 },
    { nutrientName: "Vitamin C", percentDailyValue: 120 },
    { nutrientName: "Iron", percentDailyValue: 50 },
    { nutrientName: "Calcium", percentDailyValue: 30 },
    { nutrientName: "Folate", percentDailyValue: 90 },
  ];

  it("correctly classifies vitamins", () => {
    const { vitamins } = classifyMicronutrients(nutrients);
    expect(vitamins).toHaveLength(3);
    expect(vitamins.map((v) => v.nutrientName)).toEqual([
      "Vitamin A",
      "Vitamin C",
      "Folate",
    ]);
  });

  it("correctly classifies minerals", () => {
    const { minerals } = classifyMicronutrients(nutrients);
    expect(minerals).toHaveLength(2);
    expect(minerals.map((m) => m.nutrientName)).toEqual(["Iron", "Calcium"]);
  });

  it("handles empty array", () => {
    const { vitamins, minerals } = classifyMicronutrients([]);
    expect(vitamins).toHaveLength(0);
    expect(minerals).toHaveLength(0);
  });

  it("handles all vitamins", () => {
    const allVitamins = [
      { nutrientName: "Vitamin A" },
      { nutrientName: "Vitamin B6" },
    ];
    const { vitamins, minerals } = classifyMicronutrients(allVitamins);
    expect(vitamins).toHaveLength(2);
    expect(minerals).toHaveLength(0);
  });

  it("handles all minerals", () => {
    const allMinerals = [{ nutrientName: "Iron" }, { nutrientName: "Zinc" }];
    const { vitamins, minerals } = classifyMicronutrients(allMinerals);
    expect(vitamins).toHaveLength(0);
    expect(minerals).toHaveLength(2);
  });
});

describe("countMetGoal", () => {
  it("counts nutrients at or above 100%", () => {
    const nutrients = [
      { nutrientName: "A", percentDailyValue: 100 },
      { nutrientName: "B", percentDailyValue: 150 },
      { nutrientName: "C", percentDailyValue: 99 },
    ];
    expect(countMetGoal(nutrients)).toBe(2);
  });

  it("returns 0 when none meet goal", () => {
    const nutrients = [
      { nutrientName: "A", percentDailyValue: 50 },
      { nutrientName: "B", percentDailyValue: 75 },
    ];
    expect(countMetGoal(nutrients)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(countMetGoal([])).toBe(0);
  });
});

describe("countLow", () => {
  it("counts nutrients below 25%", () => {
    const nutrients = [
      { nutrientName: "A", percentDailyValue: 10 },
      { nutrientName: "B", percentDailyValue: 24 },
      { nutrientName: "C", percentDailyValue: 25 },
      { nutrientName: "D", percentDailyValue: 50 },
    ];
    expect(countLow(nutrients)).toBe(2);
  });

  it("returns 0 when none are low", () => {
    const nutrients = [
      { nutrientName: "A", percentDailyValue: 50 },
      { nutrientName: "B", percentDailyValue: 100 },
    ];
    expect(countLow(nutrients)).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(countLow([])).toBe(0);
  });
});
