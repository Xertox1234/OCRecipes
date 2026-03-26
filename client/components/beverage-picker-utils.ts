import {
  MODIFIER_BEVERAGES,
  type BeverageType,
  type BeverageSize,
} from "@shared/constants/beverages";

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

/** Format the inline confirmation text shown after logging */
export function formatBeverageConfirmation(
  beverageName: string,
  size: BeverageSize,
): string {
  const sizeLabel = size.charAt(0).toUpperCase();
  return `${beverageName} (${sizeLabel}) added`;
}

/** Capitalize the first letter of a string */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
