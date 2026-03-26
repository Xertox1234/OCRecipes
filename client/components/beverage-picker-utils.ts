import {
  BEVERAGE_SIZES,
  MODIFIER_BEVERAGES,
  ZERO_CAL_BEVERAGES,
  type BeverageType,
  type BeverageSize,
  type BeverageModifier,
} from "@shared/constants/beverages";

/**
 * Build a natural language nutrition query from beverage selection.
 * Example: "12oz coffee with cream and sugar"
 */
export function buildNutritionQuery(
  beverage: BeverageType,
  size: BeverageSize,
  modifiers: BeverageModifier[],
): string {
  const oz = BEVERAGE_SIZES[size].oz;
  const base = `${oz}oz ${beverage}`;
  if (modifiers.length === 0) return base;
  return `${base} with ${modifiers.join(" and ")}`;
}

/**
 * Check if user input is a raw calorie number (e.g., "150" or "200.5").
 * Used by the Custom beverage path to distinguish name vs calorie entry.
 */
export function isNumericCalorieInput(input: string): boolean {
  return /^\d+(\.\d+)?$/.test(input.trim());
}

/** Whether a beverage type supports cream/sugar modifiers */
export function hasModifiers(type: BeverageType): boolean {
  return MODIFIER_BEVERAGES.includes(type);
}

/** Whether a beverage type should skip nutrition lookup (0 cal) */
export function isZeroCal(type: BeverageType): boolean {
  return ZERO_CAL_BEVERAGES.includes(type);
}

/** Format the inline confirmation text shown after logging */
export function formatBeverageConfirmation(
  beverageName: string,
  size: BeverageSize,
): string {
  const sizeLabel = size.charAt(0).toUpperCase();
  return `${beverageName} (${sizeLabel}) added`;
}
