import { describe, it, expect } from "vitest";
import {
  formatTimeDisplay,
  parseNutritionData,
} from "../recipe-detail/recipe-detail-utils";

describe("formatTimeDisplay", () => {
  it("returns null when both times are zero", () => {
    expect(formatTimeDisplay(0, 0)).toBeNull();
  });

  it("returns null when both times are null", () => {
    expect(formatTimeDisplay(null, null)).toBeNull();
  });

  it("returns null when both times are undefined", () => {
    expect(formatTimeDisplay(undefined, undefined)).toBeNull();
  });

  it("formats prep only", () => {
    expect(formatTimeDisplay(30, null)).toBe("30 min prep");
  });

  it("formats cook only", () => {
    expect(formatTimeDisplay(null, 20)).toBe("20 min cook");
  });

  it("formats both prep and cook", () => {
    expect(formatTimeDisplay(15, 25)).toBe("15 min prep · 25 min cook");
  });

  it("treats zero as falsy (same as null)", () => {
    expect(formatTimeDisplay(0, 45)).toBe("45 min cook");
  });
});

describe("parseNutritionData", () => {
  it("returns null when caloriesPerServing is null", () => {
    expect(
      parseNutritionData({
        caloriesPerServing: null,
        proteinPerServing: "20",
      }),
    ).toBeNull();
  });

  it("returns null when caloriesPerServing is undefined", () => {
    expect(parseNutritionData({})).toBeNull();
  });

  it("parses calories only (minimal data)", () => {
    const result = parseNutritionData({ caloriesPerServing: "695.5" });
    expect(result).toEqual({
      calories: 695.5,
      protein: undefined,
      carbs: undefined,
      fat: undefined,
    });
  });

  it("parses all macro fields", () => {
    const result = parseNutritionData({
      caloriesPerServing: "450",
      proteinPerServing: "30.5",
      carbsPerServing: "50",
      fatPerServing: "15.2",
    });
    expect(result).toEqual({
      calories: 450,
      protein: 30.5,
      carbs: 50,
      fat: 15.2,
    });
  });

  it("handles empty string caloriesPerServing as falsy", () => {
    expect(parseNutritionData({ caloriesPerServing: "" })).toBeNull();
  });

  it("parses partial macro data", () => {
    const result = parseNutritionData({
      caloriesPerServing: "200",
      proteinPerServing: "10",
    });
    expect(result).toEqual({
      calories: 200,
      protein: 10,
      carbs: undefined,
      fat: undefined,
    });
  });
});
