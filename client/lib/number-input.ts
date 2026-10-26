/**
 * Parse text typed into a decimal field. Accepts `.` or `,` as the decimal
 * separator (phone keypads in many locales show only one). Returns `null` for
 * empty text, a lone separator, non-numeric text, or more than one separator.
 * A trailing separator ("1.") counts as the number typed so far.
 */
export function parseDecimalInput(text: string): number | null {
  const t = text.trim();
  if (!/^(\d+[.,]?\d*|[.,]\d+)$/.test(t)) return null;
  return Number(t.replace(",", "."));
}

/**
 * True for text a person may still be typing toward a number: empty, or digits
 * followed by a lone separator ("1.", "1,", ".").
 */
export function isPartialDecimal(text: string): boolean {
  const t = text.trim();
  return t === "" || /^\d*[.,]$/.test(t);
}
