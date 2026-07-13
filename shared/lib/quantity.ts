/**
 * Quantity-string normalization shared between client ingredient parsing
 * (`client/lib/ingredient-parser.ts`) and server-side recipe normalization
 * (`server/lib/recipe-normalization.ts`).
 */

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 1 / 2,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅕": 1 / 5,
  "⅖": 2 / 5,
  "⅗": 3 / 5,
  "⅘": 4 / 5,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};

const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join("");
const UNICODE_MIXED_RE = new RegExp(
  `^(\\d+)\\s*([${UNICODE_FRACTION_CHARS}])$`,
);

/**
 * Convert a quantity string to its decimal-string form when the format is
 * recognized (integer, decimal, simple fraction, mixed number, or a single
 * unicode fraction glyph with an optional leading whole number). Returns
 * null for anything else (e.g. "a pinch", "to taste", empty) — callers
 * decide their own fallback for the unrecognized case.
 */
export function normalizeQuantityToDecimal(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const unicodeMixed = trimmed.match(UNICODE_MIXED_RE);
  if (unicodeMixed) {
    const whole = parseInt(unicodeMixed[1], 10);
    return String(whole + UNICODE_FRACTIONS[unicodeMixed[2]]);
  }

  if (trimmed.length === 1 && trimmed in UNICODE_FRACTIONS) {
    return String(UNICODE_FRACTIONS[trimmed]);
  }

  const compound = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (compound) {
    const whole = parseInt(compound[1], 10);
    const num = parseInt(compound[2], 10);
    const den = parseInt(compound[3], 10);
    if (den === 0) return null;
    return String(whole + num / den);
  }

  const frac = trimmed.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const num = parseInt(frac[1], 10);
    const den = parseInt(frac[2], 10);
    if (den === 0) return null;
    return String(num / den);
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}
