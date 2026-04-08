import { describe, it, expect } from "vitest";
import { parseNutritionFromOCR } from "../nutrition-ocr-parser";

describe("parseNutritionFromOCR", () => {
  it("extracts all fields from a standard US nutrition label", () => {
    const text = `Nutrition Facts
Serving Size 1 cup (228g)
Servings Per Container 2
Calories 250
Total Fat 12g
  Saturated Fat 3g
  Trans Fat 0g
Cholesterol 30mg
Sodium 470mg
Total Carbohydrate 31g
  Dietary Fiber 0g
  Total Sugars 5g
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
    expect(result.totalFat).toBe(12);
    expect(result.saturatedFat).toBe(3);
    expect(result.transFat).toBe(0);
    expect(result.cholesterol).toBe(30);
    expect(result.sodium).toBe(470);
    expect(result.totalCarbs).toBe(31);
    expect(result.dietaryFiber).toBe(0);
    expect(result.totalSugars).toBe(5);
    expect(result.protein).toBe(5);
    expect(result.servingSize).toBe("1 cup (228g)");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("handles decimal values", () => {
    const text = `Calories 120
Total Fat 1.5g
Saturated Fat 0.5g
Trans Fat 0g
Protein 2.5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.totalFat).toBe(1.5);
    expect(result.saturatedFat).toBe(0.5);
    expect(result.protein).toBe(2.5);
  });

  it("handles common OCR misreads (O→0, l→1)", () => {
    const text = `Calories 25O
Total Fat l2g
Sodium 47Omg
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
    expect(result.totalFat).toBe(12);
    expect(result.sodium).toBe(470);
  });

  it("returns null fields for missing data and low confidence", () => {
    const text = `Calories 200
Protein 10g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(200);
    expect(result.protein).toBe(10);
    expect(result.totalFat).toBeNull();
    expect(result.sodium).toBeNull();
    expect(result.totalCarbs).toBeNull();
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("returns all-null with zero confidence for non-nutrition text", () => {
    const text = "Hello world this is not a nutrition label";

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns all-null with zero confidence for empty string", () => {
    const result = parseNutritionFromOCR("");
    expect(result.confidence).toBe(0);
    expect(result.calories).toBeNull();
  });

  it("handles 'less than' values (e.g., <1g)", () => {
    const text = `Calories 50
Total Fat 0g
Trans Fat 0g
Cholesterol <5mg
Sodium 10mg
Total Carbohydrate 13g
  Dietary Fiber <1g
  Total Sugars 10g
Protein 0g`;

    const result = parseNutritionFromOCR(text);
    expect(result.cholesterol).toBe(5);
    expect(result.dietaryFiber).toBe(1);
  });

  it("handles values with percent daily value on same line", () => {
    const text = `Calories 140
Total Fat 8g 10%
  Saturated Fat 1g 5%
Sodium 200mg 9%
Total Carbohydrate 15g 5%
Protein 3g`;

    const result = parseNutritionFromOCR(text);
    expect(result.totalFat).toBe(8);
    expect(result.saturatedFat).toBe(1);
    expect(result.sodium).toBe(200);
    expect(result.totalCarbs).toBe(15);
  });

  it("handles 'Total Carb' and 'Total Carb.' abbreviations", () => {
    const text = `Calories 100
Total Carb. 20g
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.totalCarbs).toBe(20);
  });

  it("handles serving size on same line as label", () => {
    const text = `Serving Size 2/3 cup (55g)
Calories 230`;

    const result = parseNutritionFromOCR(text);
    expect(result.servingSize).toBe("2/3 cup (55g)");
    expect(result.calories).toBe(230);
  });

  it("handles S→5 OCR misread adjacent to digits", () => {
    const text = `Calories 2S0
Total Fat 1Sg`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
    expect(result.totalFat).toBe(15);
  });

  it("rejects negative values from OCR misread", () => {
    const text = `Calories -120
Total Fat -5g
Protein 10g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBeNull();
    expect(result.totalFat).toBeNull();
    expect(result.protein).toBe(10);
  });

  it("rejects unreasonably large values", () => {
    const text = `Calories 99999
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBeNull();
    expect(result.protein).toBe(5);
  });

  it("returns null for garbage non-numeric data", () => {
    const text = `Calories abc
Total Fat --g
Sodium XYZmg`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBeNull();
    expect(result.totalFat).toBeNull();
    expect(result.sodium).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("skips 'Calories from Fat' and extracts actual calories", () => {
    const text = `Calories from Fat 90
Calories 250
Total Fat 10g
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
  });

  it("caps serving size string length at 100 characters", () => {
    const longText = "A".repeat(200);
    const text = `Serving Size ${longText}
Calories 100`;

    const result = parseNutritionFromOCR(text);
    expect(result.servingSize).toHaveLength(100);
  });
});
