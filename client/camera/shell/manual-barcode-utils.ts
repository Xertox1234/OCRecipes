// Valid retail barcode lengths: EAN-8, UPC-A, EAN-13, GTIN-14.
const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Turns what the user typed into barcode digits: spaces and dashes are
 * dropped, then it must be all digits and one of the valid lengths.
 * Returns null otherwise.
 */
export function normalizeTypedBarcode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  return VALID_LENGTHS.has(digits.length) ? digits : null;
}
