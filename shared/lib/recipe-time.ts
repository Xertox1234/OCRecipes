const HOURS_RE = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i;
// Last minutes figure wins, so a range "20-30 min" reads as 30 (the
// conservative end for a "quick" claim).
const MINUTES_RE = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/gi;

/** Reads free-text `timeEstimate` ("30 min", "1 hr 15 min"). Unitless or unreadable → null. */
export function parseTimeEstimateMinutes(
  text: string | null | undefined,
): number | null {
  if (!text) return null;
  const hours = text.match(HOURS_RE);
  const minuteMatches = [...text.matchAll(MINUTES_RE)];
  if (!hours && minuteMatches.length === 0) return null;
  const minutes = minuteMatches.length
    ? parseInt(minuteMatches[minuteMatches.length - 1][1], 10)
    : 0;
  const total = Math.round((hours ? parseFloat(hours[1]) * 60 : 0) + minutes);
  return total > 0 ? total : null;
}

/**
 * The one definition of a recipe's total time (spec 2026-10-17): prep + cook
 * only when BOTH are known; otherwise the parsed `timeEstimate`; otherwise null.
 */
export function toTotalTimeMinutes(t: {
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  timeEstimate?: string | null;
}): number | null {
  if (t.prepTimeMinutes != null && t.cookTimeMinutes != null) {
    return t.prepTimeMinutes + t.cookTimeMinutes;
  }
  return parseTimeEstimateMinutes(t.timeEstimate);
}
