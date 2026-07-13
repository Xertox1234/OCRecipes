import { normalizeQuantityToDecimal } from "@shared/lib/quantity";

export interface ParsedIngredientResult {
  name: string;
  quantity: string | null;
  unit: string | null;
}

const UNITS =
  /^(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|oz|ounces?|g|grams?|lbs?|pounds?|ml|kg|cloves?|pinch|dash|bunch|cans?|pkg|slices?|pieces?|whole)\b/i;

/**
 * Parse a natural-language ingredient string into structured parts.
 *
 * Input: "2 cups flour", "1/2 tsp salt", "flour", "1 1/2 cups milk"
 * Output: { name, quantity (decimal string), unit }
 *
 * Quantity is returned as a string (decimal form) for DB storage.
 * Unparseable input stores the full text in `name` with null quantity/unit.
 */
export function parseIngredientText(raw: string): ParsedIngredientResult {
  let remaining = raw.trim();

  // Try to match leading quantity: "1 1/2", "1/2", "1.5", "2"
  const qtyMatch = remaining.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+\.?\d*)\s*/);
  if (!qtyMatch) {
    return { name: remaining, quantity: null, unit: null };
  }

  const quantityStr = qtyMatch[1];
  remaining = remaining.slice(qtyMatch[0].length);

  // Convert quantity to decimal string for the DB
  const converted = normalizeQuantityToDecimal(quantityStr);
  const quantity = converted ?? quantityStr;

  // Try to match unit
  const unitMatch = remaining.match(UNITS);
  if (unitMatch) {
    remaining = remaining.slice(unitMatch[0].length).trim();
    return {
      name: remaining || raw,
      quantity,
      unit: unitMatch[1].toLowerCase(),
    };
  }

  return { name: remaining || raw, quantity, unit: null };
}
