/**
 * Parse a quantity string into a number.
 * Handles whole numbers, decimals, simple fractions ("1/2"),
 * and mixed fractions ("1 1/2").
 * Returns null for non-numeric values like "to taste".
 */
export function parseFraction(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Try plain number first (integer or decimal)
  const plain = Number(trimmed);
  if (!isNaN(plain)) return plain;

  // Try mixed fraction: "1 1/2"
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10);
    const num = parseInt(mixedMatch[2], 10);
    const den = parseInt(mixedMatch[3], 10);
    if (den === 0) return null;
    return whole + num / den;
  }

  // Try simple fraction: "1/2"
  const fracMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    const num = parseInt(fracMatch[1], 10);
    const den = parseInt(fracMatch[2], 10);
    if (den === 0) return null;
    return num / den;
  }

  return null;
}

/** Common cooking fractions: [decimal fractional part, display string] */
const FRACTION_MAP: [number, string][] = [
  [1 / 8, "1/8"],
  [1 / 4, "1/4"],
  [1 / 3, "1/3"],
  [3 / 8, "3/8"],
  [1 / 2, "1/2"],
  [5 / 8, "5/8"],
  [2 / 3, "2/3"],
  [3 / 4, "3/4"],
  [7 / 8, "7/8"],
];

// Tight tolerance prevents false snapping (e.g. 1.67 should not match 2/3)
const FRACTION_TOLERANCE = 0.003;

/**
 * Format a number as a cooking-friendly fraction string.
 * Supports ½, ⅓, ¼, ¾, ⅔, ⅛ etc.
 * Falls back to 1 decimal place for uncommon fractions.
 */
export function formatAsFraction(value: number): string {
  if (value < 0) return formatAsFraction(-value);

  const whole = Math.floor(value);
  const frac = value - whole;

  // Pure whole number (or very close)
  if (frac < FRACTION_TOLERANCE) {
    return String(whole);
  }

  // Check if fractional part matches a known cooking fraction
  for (const [target, label] of FRACTION_MAP) {
    if (Math.abs(frac - target) < FRACTION_TOLERANCE) {
      return whole > 0 ? `${whole} ${label}` : label;
    }
  }

  // Check if close to next whole number
  if (1 - frac < FRACTION_TOLERANCE) {
    return String(whole + 1);
  }

  // Fallback: 1 decimal place
  const rounded = parseFloat(value.toFixed(1));
  // Avoid trailing .0
  if (rounded === Math.floor(rounded)) {
    return String(Math.floor(rounded));
  }
  return String(rounded);
}

/**
 * Scale an ingredient quantity by the given ratio.
 * Returns the formatted scaled quantity and whether the input was numeric.
 */
export function scaleIngredientQuantity(
  quantity: string | number | null | undefined,
  ratio: number,
): { scaled: string | null; isNumeric: boolean } {
  if (quantity == null) return { scaled: null, isNumeric: false };

  // Number type: scale directly
  if (typeof quantity === "number") {
    return { scaled: formatAsFraction(quantity * ratio), isNumeric: true };
  }

  // String type: try parsing
  const parsed = parseFraction(quantity);
  if (parsed === null) {
    return { scaled: null, isNumeric: false };
  }

  return { scaled: formatAsFraction(parsed * ratio), isNumeric: true };
}
