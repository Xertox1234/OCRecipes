import { describe, it, expect } from "vitest";
import {
  buildNutrientRows,
  localDataToExtractionResult,
  shouldReplaceWithAI,
} from "../label-analysis-utils";
import type { LabelExtractionResult } from "@/lib/photo-upload";
import type { LocalNutritionData } from "@/lib/nutrition-ocr-parser";

const baseLabelData: LabelExtractionResult = {
  servingSize: "1 cup",
  servingsPerContainer: 2,
  calories: 250,
  totalFat: 12,
  saturatedFat: 3,
  transFat: 0,
  cholesterol: 30,
  sodium: 470,
  totalCarbs: 31,
  dietaryFiber: 0,
  totalSugars: 5,
  addedSugars: 2,
  protein: 5,
  vitaminD: 2,
  calcium: 260,
  iron: 8,
  potassium: 235,
  confidence: 0.95,
  productName: "Test Product",
};

describe("buildNutrientRows", () => {
  it("returns 15 rows with correct labels", () => {
    const rows = buildNutrientRows(baseLabelData);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toEqual({
      label: "Calories",
      value: 250,
      unit: "kcal",
      bold: true,
    });
    expect(rows[10]).toEqual({
      label: "Protein",
      value: 5,
      unit: "g",
      bold: true,
    });
  });

  it("marks macro rows as bold and sub-rows as indented", () => {
    const rows = buildNutrientRows(baseLabelData);
    expect(rows[1].bold).toBe(true); // Total Fat
    expect(rows[2].indented).toBe(true); // Saturated Fat
    expect(rows[3].indented).toBe(true); // Trans Fat
  });

  it("handles null values", () => {
    const data = { ...baseLabelData, calories: null, vitaminD: null };
    const rows = buildNutrientRows(data);
    expect(rows[0].value).toBeNull();
    expect(rows[11].value).toBeNull();
  });
});

describe("localDataToExtractionResult", () => {
  const localData: LocalNutritionData = {
    calories: 200,
    totalFat: 10,
    saturatedFat: 3,
    transFat: 0,
    cholesterol: 25,
    sodium: 400,
    totalCarbs: 30,
    dietaryFiber: 2,
    totalSugars: 8,
    protein: 7,
    servingSize: "1 serving",
    confidence: 0.8,
  };

  it("maps all local fields to extraction result", () => {
    const result = localDataToExtractionResult(localData);
    expect(result.calories).toBe(200);
    expect(result.totalFat).toBe(10);
    expect(result.protein).toBe(7);
    expect(result.servingSize).toBe("1 serving");
    expect(result.confidence).toBe(0.8);
  });

  it("sets fields not in local data to null", () => {
    const result = localDataToExtractionResult(localData);
    expect(result.addedSugars).toBeNull();
    expect(result.vitaminD).toBeNull();
    expect(result.calcium).toBeNull();
    expect(result.iron).toBeNull();
    expect(result.potassium).toBeNull();
    expect(result.productName).toBeNull();
    expect(result.servingsPerContainer).toBeNull();
  });
});

describe("shouldReplaceWithAI", () => {
  it("returns false when values match exactly", () => {
    expect(shouldReplaceWithAI(baseLabelData, baseLabelData)).toBe(false);
  });

  it("returns false when difference is within 10%", () => {
    const ai = { ...baseLabelData, calories: 260 }; // 4% diff
    expect(shouldReplaceWithAI(baseLabelData, ai)).toBe(false);
  });

  it("returns true when calories differ by more than 10%", () => {
    const ai = { ...baseLabelData, calories: 300 }; // 20% diff
    expect(shouldReplaceWithAI(baseLabelData, ai)).toBe(true);
  });

  it("returns true when protein differs by more than 10%", () => {
    const ai = { ...baseLabelData, protein: 10 }; // 100% diff
    expect(shouldReplaceWithAI(baseLabelData, ai)).toBe(true);
  });

  it("skips comparison when local or AI field is null", () => {
    const local = { ...baseLabelData, calories: null } as LabelExtractionResult;
    const ai = { ...baseLabelData, calories: 500 };
    expect(shouldReplaceWithAI(local, ai)).toBe(false);
  });

  it("skips comparison when both values are zero", () => {
    const local = { ...baseLabelData, totalFat: 0 };
    const ai = { ...baseLabelData, totalFat: 0 };
    expect(shouldReplaceWithAI(local, ai)).toBe(false);
  });

  it("uses max(abs(local), abs(ai), 1) as base to avoid division issues", () => {
    const local = { ...baseLabelData, totalFat: 0 };
    const ai = { ...baseLabelData, totalFat: 1 }; // diff=1, base=max(0,1,1)=1, ratio=1.0 > 0.1
    expect(shouldReplaceWithAI(local, ai)).toBe(true);
  });
});
