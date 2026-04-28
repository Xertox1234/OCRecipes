/**
 * Pure utility functions for MicronutrientSection.
 * No React / React Native imports — safe to test directly in Vitest.
 */

export interface MicronutrientData {
  nutrientName: string;
  amount: number;
  unit: string;
  percentDailyValue: number;
}

const VITAMIN_NAMES = new Set([
  "Folate",
  "Niacin",
  "Thiamin",
  "Riboflavin",
  "Biotin",
  "Pantothenic Acid",
]);

/**
 * Splits micronutrients into vitamins and minerals groups.
 * Vitamins: names starting with "Vitamin", or known B-vitamin chemical names.
 * Minerals: everything else.
 */
export function classifyMicronutrients(data: MicronutrientData[]): {
  vitamins: MicronutrientData[];
  minerals: MicronutrientData[];
} {
  const vitamins: MicronutrientData[] = [];
  const minerals: MicronutrientData[] = [];

  for (const item of data) {
    const name = item.nutrientName.trim();
    if (name.startsWith("Vitamin") || VITAMIN_NAMES.has(name)) {
      vitamins.push(item);
    } else {
      minerals.push(item);
    }
  }

  return { vitamins, minerals };
}

/**
 * Returns the appropriate color for a daily value percentage.
 * Green for >50%, yellow/warning for 25-50%, gray/muted for <25%.
 */
export function getDVColor(
  percentDV: number,
  theme: { success: string; warning: string; textSecondary: string },
): string {
  if (percentDV > 50) {
    return theme.success;
  }
  if (percentDV >= 25) {
    return theme.warning;
  }
  return theme.textSecondary;
}
