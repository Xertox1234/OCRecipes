import { describe, it, expect } from "vitest";
import {
  buildNutritionQuery,
  isNumericCalorieInput,
  hasModifiers,
  isZeroCal,
  formatBeverageConfirmation,
} from "../beverage-picker-utils";

describe("buildNutritionQuery", () => {
  it("builds query with size and beverage name", () => {
    expect(buildNutritionQuery("coffee", "medium", [])).toBe("12oz coffee");
  });

  it("builds query with single modifier", () => {
    expect(buildNutritionQuery("coffee", "large", ["cream"])).toBe(
      "16oz coffee with cream",
    );
  });

  it("builds query with multiple modifiers", () => {
    expect(buildNutritionQuery("tea", "small", ["cream", "sugar"])).toBe(
      "8oz tea with cream and sugar",
    );
  });

  it("uses correct oz for each size", () => {
    expect(buildNutritionQuery("milk", "small", [])).toBe("8oz milk");
    expect(buildNutritionQuery("milk", "medium", [])).toBe("12oz milk");
    expect(buildNutritionQuery("milk", "large", [])).toBe("16oz milk");
  });
});

describe("isNumericCalorieInput", () => {
  it("returns true for whole numbers", () => {
    expect(isNumericCalorieInput("150")).toBe(true);
    expect(isNumericCalorieInput("0")).toBe(true);
    expect(isNumericCalorieInput("5000")).toBe(true);
  });

  it("returns true for decimal numbers", () => {
    expect(isNumericCalorieInput("200.5")).toBe(true);
    expect(isNumericCalorieInput("0.5")).toBe(true);
  });

  it("returns false for text", () => {
    expect(isNumericCalorieInput("matcha latte")).toBe(false);
    expect(isNumericCalorieInput("")).toBe(false);
    expect(isNumericCalorieInput("7Up")).toBe(false);
  });

  it("trims whitespace", () => {
    expect(isNumericCalorieInput("  150  ")).toBe(true);
  });

  it("rejects mixed input", () => {
    expect(isNumericCalorieInput("150cal")).toBe(false);
    expect(isNumericCalorieInput("150 kcal")).toBe(false);
  });
});

describe("hasModifiers", () => {
  it("returns true for coffee and tea", () => {
    expect(hasModifiers("coffee")).toBe(true);
    expect(hasModifiers("tea")).toBe(true);
  });

  it("returns false for other beverages", () => {
    expect(hasModifiers("water")).toBe(false);
    expect(hasModifiers("milk")).toBe(false);
    expect(hasModifiers("soda")).toBe(false);
    expect(hasModifiers("custom")).toBe(false);
  });
});

describe("isZeroCal", () => {
  it("returns true for water", () => {
    expect(isZeroCal("water")).toBe(true);
  });

  it("returns false for caloric beverages", () => {
    expect(isZeroCal("coffee")).toBe(false);
    expect(isZeroCal("milk")).toBe(false);
    expect(isZeroCal("soda")).toBe(false);
  });
});

describe("formatBeverageConfirmation", () => {
  it("formats confirmation with size initial", () => {
    expect(formatBeverageConfirmation("Coffee", "medium")).toBe(
      "Coffee (M) added",
    );
  });

  it("capitalizes size initial", () => {
    expect(formatBeverageConfirmation("Tea", "small")).toBe("Tea (S) added");
    expect(formatBeverageConfirmation("Milk", "large")).toBe("Milk (L) added");
  });
});
