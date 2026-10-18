const HOURS_RE = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/gi;
const MINUTES_RE = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/gi;
// Joins two figures into a range ("20 min to 30 min"): the larger end counts
// (the conservative end for a "quick" claim). "20-30 min" has only one unit and
// reads as 30 through the minutes figure alone.
const RANGE_JOIN_RE = /^\s*(?:-|\u2013|\u2014|to|or)\s*$/i;

/**
 * Reads free-text `timeEstimate` ("30 min", "1 hr 15 min", "Prep 10 min, cook
 * 25 min"). Listed parts are summed; a range takes its larger end. Unitless or
 * unreadable → null.
 */
export function parseTimeEstimateMinutes(
  text: string | null | undefined,
): number | null {
  if (!text) return null;
  const figures = [
    ...[...text.matchAll(HOURS_RE)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      minutes: parseFloat(m[1]) * 60,
    })),
    ...[...text.matchAll(MINUTES_RE)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      minutes: parseInt(m[1], 10),
    })),
  ].sort((a, b) => a.start - b.start);
  if (figures.length === 0) return null;
  let total = 0;
  let prev: { end: number; minutes: number } | null = null;
  for (const f of figures) {
    if (prev && RANGE_JOIN_RE.test(text.slice(prev.end, f.start))) {
      // Range: replace the previous figure with the larger end.
      total += Math.max(f.minutes - prev.minutes, 0);
      prev = { end: f.end, minutes: Math.max(f.minutes, prev.minutes) };
    } else {
      total += f.minutes;
      prev = { end: f.end, minutes: f.minutes };
    }
  }
  total = Math.round(total);
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
