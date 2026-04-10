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
