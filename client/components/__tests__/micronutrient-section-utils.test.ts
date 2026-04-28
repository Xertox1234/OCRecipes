import { describe, it, expect } from "vitest";

import {
  classifyMicronutrients,
  getDVColor,
  type MicronutrientData,
} from "../micronutrient-section-utils";

describe("classifyMicronutrients", () => {
  it("classifies vitamins and minerals correctly", () => {
    const data: MicronutrientData[] = [
      {
        nutrientName: "Vitamin A",
        amount: 900,
        unit: "mcg",
        percentDailyValue: 100,
      },
      {
        nutrientName: "Vitamin C",
        amount: 90,
        unit: "mg",
        percentDailyValue: 100,
      },
      {
        nutrientName: "Calcium",
        amount: 1300,
        unit: "mg",
        percentDailyValue: 100,
      },
      { nutrientName: "Iron", amount: 18, unit: "mg", percentDailyValue: 100 },
      {
        nutrientName: "Folate",
        amount: 400,
        unit: "mcg",
        percentDailyValue: 100,
      },
    ];

    const result = classifyMicronutrients(data);
    expect(result.vitamins).toHaveLength(3);
    expect(result.minerals).toHaveLength(2);
    expect(result.vitamins.map((v) => v.nutrientName)).toEqual([
      "Vitamin A",
      "Vitamin C",
      "Folate",
    ]);
    expect(result.minerals.map((m) => m.nutrientName)).toEqual([
      "Calcium",
      "Iron",
    ]);
  });

  it("classifies B-vitamin chemical names as vitamins", () => {
    const data: MicronutrientData[] = [
      {
        nutrientName: "Niacin",
        amount: 16,
        unit: "mg",
        percentDailyValue: 100,
      },
      {
        nutrientName: "Thiamin",
        amount: 1.2,
        unit: "mg",
        percentDailyValue: 100,
      },
      {
        nutrientName: "Riboflavin",
        amount: 1.3,
        unit: "mg",
        percentDailyValue: 100,
      },
      {
        nutrientName: "Biotin",
        amount: 30,
        unit: "mcg",
        percentDailyValue: 100,
      },
      {
        nutrientName: "Pantothenic Acid",
        amount: 5,
        unit: "mg",
        percentDailyValue: 100,
      },
    ];

    const result = classifyMicronutrients(data);
    expect(result.vitamins).toHaveLength(5);
    expect(result.minerals).toHaveLength(0);
  });

  it("returns empty arrays for empty input", () => {
    const result = classifyMicronutrients([]);
    expect(result.vitamins).toEqual([]);
    expect(result.minerals).toEqual([]);
  });

  it("trims whitespace from nutrient names", () => {
    const data: MicronutrientData[] = [
      {
        nutrientName: "  Vitamin A  ",
        amount: 900,
        unit: "mcg",
        percentDailyValue: 100,
      },
      {
        nutrientName: "  Calcium  ",
        amount: 1300,
        unit: "mg",
        percentDailyValue: 100,
      },
    ];

    const result = classifyMicronutrients(data);
    expect(result.vitamins).toHaveLength(1);
    expect(result.minerals).toHaveLength(1);
  });
});

describe("getDVColor", () => {
  const theme = {
    success: "#007A30",
    warning: "#FF9800",
    textSecondary: "#6B6B6B",
  };

  it("returns success color for >50% DV", () => {
    expect(getDVColor(51, theme)).toBe(theme.success);
    expect(getDVColor(100, theme)).toBe(theme.success);
    expect(getDVColor(200, theme)).toBe(theme.success);
  });

  it("returns warning color for 25-50% DV", () => {
    expect(getDVColor(25, theme)).toBe(theme.warning);
    expect(getDVColor(37, theme)).toBe(theme.warning);
    expect(getDVColor(50, theme)).toBe(theme.warning);
  });

  it("returns textSecondary color for <25% DV", () => {
    expect(getDVColor(0, theme)).toBe(theme.textSecondary);
    expect(getDVColor(12, theme)).toBe(theme.textSecondary);
    expect(getDVColor(24, theme)).toBe(theme.textSecondary);
  });
});
