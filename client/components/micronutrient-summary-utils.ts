/**
 * Pure classification and stat utilities for MicronutrientSummary.
 * Extracted for testability — no React or RN dependencies.
 */

interface MicronutrientEntry {
  nutrientName: string;
  percentDailyValue: number;
}

export const VITAMIN_NAMES = new Set([
  "Vitamin A",
  "Vitamin C",
  "Vitamin D",
  "Vitamin E",
  "Vitamin K",
  "Vitamin B1 (Thiamin)",
  "Vitamin B2 (Riboflavin)",
  "Vitamin B3 (Niacin)",
  "Vitamin B6",
  "Vitamin B12",
  "Folate",
]);

/** Classify micronutrients into vitamins and minerals. */
export function classifyMicronutrients<T extends { nutrientName: string }>(
  micronutrients: T[],
): { vitamins: T[]; minerals: T[] } {
  return {
    vitamins: micronutrients.filter((n) => VITAMIN_NAMES.has(n.nutrientName)),
    minerals: micronutrients.filter((n) => !VITAMIN_NAMES.has(n.nutrientName)),
  };
}

/** Count how many micronutrients have met their daily goal (>= 100%). */
export function countMetGoal(micronutrients: MicronutrientEntry[]): number {
  return micronutrients.filter((n) => n.percentDailyValue >= 100).length;
}

/** Count how many micronutrients are low (< 25% daily value). */
export function countLow(micronutrients: MicronutrientEntry[]): number {
  return micronutrients.filter((n) => n.percentDailyValue < 25).length;
}
