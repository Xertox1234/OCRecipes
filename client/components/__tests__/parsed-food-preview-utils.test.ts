import { describe, it, expect } from "vitest";
import {
  formatNutrientValue,
  formatMacroLine,
  nutritionCaption,
} from "../parsed-food-preview-utils";

describe("formatNutrientValue", () => {
  it("rounds to integer", () => {
    expect(formatNutrientValue(250.7)).toBe("251");
    expect(formatNutrientValue(99.2)).toBe("99");
  });

  it("handles whole numbers", () => {
    expect(formatNutrientValue(100)).toBe("100");
  });

  it("handles zero", () => {
    expect(formatNutrientValue(0)).toBe("0");
  });

  it("returns ? for null", () => {
    expect(formatNutrientValue(null)).toBe("?");
  });

  it("handles negative values", () => {
    expect(formatNutrientValue(-5.6)).toBe("-6");
    expect(formatNutrientValue(-0.4)).toBe("0");
  });
});

describe("formatMacroLine", () => {
  it("formats all values present", () => {
    expect(formatMacroLine(250, 20, 30, 10)).toBe(
      "250 cal | P: 20 | C: 30 | F: 10",
    );
  });

  it("rounds values", () => {
    expect(formatMacroLine(250.7, 19.8, 30.3, 10.1)).toBe(
      "251 cal | P: 20 | C: 30 | F: 10",
    );
  });

  it("handles null values with ?", () => {
    expect(formatMacroLine(250, null, 30, null)).toBe(
      "250 cal | P: ? | C: 30 | F: ?",
    );
  });

  it("handles all null values", () => {
    expect(formatMacroLine(null, null, null, null)).toBe(
      "? cal | P: ? | C: ? | F: ?",
    );
  });
});

describe("nutritionCaption", () => {
  it("shows the macro line when calories are known", () => {
    expect(
      nutritionCaption({ calories: 250, protein: 20, carbs: 30, fat: 10 }),
    ).toBe("250 cal | P: 20 | C: 30 | F: 10");
  });

  // A lookup miss is stored with no calories, which the day total counts as
  // 0 — say so before the user logs it, never show nothing.
  it("says the food logs as 0 cal when no nutrition was found", () => {
    expect(
      nutritionCaption({
        calories: null,
        protein: null,
        carbs: null,
        fat: null,
      }),
    ).toBe("No nutrition found — logs as 0 cal");
  });
});
