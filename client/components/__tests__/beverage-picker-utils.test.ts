import { describe, it, expect } from "vitest";
import {
  isNumericCalorieInput,
  hasModifiers,
  formatBeverageConfirmation,
  capitalize,
} from "../beverage-picker-utils";

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

describe("capitalize", () => {
  it("capitalizes the first letter", () => {
    expect(capitalize("cream")).toBe("Cream");
    expect(capitalize("sugar")).toBe("Sugar");
  });

  it("handles single character", () => {
    expect(capitalize("a")).toBe("A");
  });

  it("handles empty string", () => {
    expect(capitalize("")).toBe("");
  });
});
