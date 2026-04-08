import type { LabelExtractionResult } from "@/lib/photo-upload";
import type { LocalNutritionData } from "@/lib/nutrition-ocr-parser";

export interface NutrientRow {
  label: string;
  value: number | null;
  unit: string;
  indented?: boolean;
  bold?: boolean;
}

export function buildNutrientRows(data: LabelExtractionResult): NutrientRow[] {
  return [
    { label: "Calories", value: data.calories, unit: "kcal", bold: true },
    { label: "Total Fat", value: data.totalFat, unit: "g", bold: true },
    {
      label: "Saturated Fat",
      value: data.saturatedFat,
      unit: "g",
      indented: true,
    },
    { label: "Trans Fat", value: data.transFat, unit: "g", indented: true },
    { label: "Cholesterol", value: data.cholesterol, unit: "mg", bold: true },
    { label: "Sodium", value: data.sodium, unit: "mg", bold: true },
    {
      label: "Total Carbohydrates",
      value: data.totalCarbs,
      unit: "g",
      bold: true,
    },
    {
      label: "Dietary Fiber",
      value: data.dietaryFiber,
      unit: "g",
      indented: true,
    },
    {
      label: "Total Sugars",
      value: data.totalSugars,
      unit: "g",
      indented: true,
    },
    {
      label: "Added Sugars",
      value: data.addedSugars,
      unit: "g",
      indented: true,
    },
    { label: "Protein", value: data.protein, unit: "g", bold: true },
    { label: "Vitamin D", value: data.vitaminD, unit: "mcg" },
    { label: "Calcium", value: data.calcium, unit: "mg" },
    { label: "Iron", value: data.iron, unit: "mg" },
    { label: "Potassium", value: data.potassium, unit: "mg" },
  ];
}

/** Convert LocalNutritionData to LabelExtractionResult for display */
export function localDataToExtractionResult(
  data: LocalNutritionData,
): LabelExtractionResult {
  return {
    servingSize: data.servingSize,
    servingsPerContainer: null,
    calories: data.calories,
    totalFat: data.totalFat,
    saturatedFat: data.saturatedFat,
    transFat: data.transFat,
    cholesterol: data.cholesterol,
    sodium: data.sodium,
    totalCarbs: data.totalCarbs,
    dietaryFiber: data.dietaryFiber,
    totalSugars: data.totalSugars,
    addedSugars: null,
    protein: data.protein,
    vitaminD: null,
    calcium: null,
    iron: null,
    potassium: null,
    confidence: data.confidence,
    productName: null,
  };
}

/** Check if AI data differs significantly from local OCR (>10% on any core field) */
export function shouldReplaceWithAI(
  local: LabelExtractionResult,
  ai: LabelExtractionResult,
): boolean {
  const fields: (keyof LabelExtractionResult)[] = [
    "calories",
    "totalFat",
    "protein",
    "totalCarbs",
    "sodium",
  ];

  for (const field of fields) {
    const localVal = local[field];
    const aiVal = ai[field];
    if (typeof localVal !== "number" || typeof aiVal !== "number") continue;
    if (localVal === 0 && aiVal === 0) continue;
    const diff = Math.abs(localVal - aiVal);
    const base = Math.max(Math.abs(localVal), Math.abs(aiVal), 1);
    if (diff / base > 0.1) return true;
  }
  return false;
}
