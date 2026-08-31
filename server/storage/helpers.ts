import { civilDateString, civilMidnightUtcMs } from "../lib/civil-date";

/** Escape ILIKE metacharacters so user input is treated as literal text. */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * Returns the start (00:00:00.000) and end (23:59:59.999) of the given day,
 * computed in the specified IANA timezone (defaults to UTC).
 *
 * `endOfDay` is the last millisecond of the day, but every day-bounds caller in
 * this repo compares with `lt` rather than `lte`, so that millisecond is in
 * practice never included. This is consistent across all of them, so there is no
 * cross-consumer skew — noted because the signature reads as inclusive and the
 * usage is not. A cleaner shape would return an exclusive next-local-midnight
 * bound and drop the `- 1`; that touches a dozen call sites and is deliberately
 * out of scope here.
 *
 * Using an optional `tz` param keeps all existing callers (which never passed
 * a tz) behaviorally identical — they continue to get UTC day bounds.
 *
 * DST correctness: uses a two-step offset correction via `civilMidnightUtcMs`
 * so that spring-forward / fall-back days are bounded correctly (not off by 1h).
 * The "end of day" is the start of the *next* calendar day minus 1ms.
 *
 * "Tomorrow" is derived from the CALENDAR (`Date.UTC(y, m - 1, d + 1)`), not by
 * adding a fixed number of hours. An earlier version added 25h on the premise
 * that no local day is longer than that; `Antarctica/Troll` shifts by two hours
 * and so has 22h and 26h days, on which the heuristic landed back inside the
 * SAME day and produced bounds whose end preceded their start. See the comment
 * at the derivation itself.
 */
export function getDayBounds(
  date: Date,
  tz: string = "UTC",
): {
  startOfDay: Date;
  endOfDay: Date;
} {
  // NOTE: `date` is treated as an INSTANT — this returns the bounds of whatever
  // civil day that instant falls in. If you hold a `yyyy-mm-dd` calendar date
  // rather than an instant, convert it with `civilDateToInstant(dateStr, tz)`
  // first; `new Date(dateStr)` will silently pick the previous day west of
  // Greenwich.
  const [localYear, localMonth, localDay] = civilDateString(date, tz)
    .split("-")
    .map(Number) as [number, number, number];

  const startUtcMs = civilMidnightUtcMs(localYear, localMonth, localDay, tz);

  // "Tomorrow" is derived from the CALENDAR, not by adding hours. The previous
  // "+25h then read the civil date" heuristic assumed no local day exceeds 25
  // hours. `Antarctica/Troll` shifts by TWO hours (UTC+0 <-> UTC+2), so its
  // fall-back day is 26 hours long: +25h landed back inside the same day,
  // "tomorrow" resolved to today, and endOfDay came out one millisecond BEFORE
  // startOfDay — inverted bounds, so every query for that day returned nothing.
  // `Date.UTC` normalises day overflow (day 32 -> the 1st of the next month),
  // so this is exact for any transition magnitude.
  const tomorrow = new Date(Date.UTC(localYear, localMonth - 1, localDay + 1));
  const endUtcMs =
    civilMidnightUtcMs(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
      tz,
    ) - 1;

  return { startOfDay: new Date(startUtcMs), endOfDay: new Date(endUtcMs) };
}

/**
 * Returns the first day 00:00:00.000 and last day 23:59:59.999 of the month
 * containing the given date, computed in the specified IANA timezone (defaults
 * to UTC). Existing callers without a tz get the same UTC behaviour as before.
 */
export function getMonthBounds(
  date: Date,
  tz: string = "UTC",
): {
  startOfMonth: Date;
  endOfMonth: Date;
} {
  const [localYear, localMonth] = civilDateString(date, tz)
    .split("-")
    .map(Number) as [number, number, number];

  const startUtcMs = civilMidnightUtcMs(localYear, localMonth, 1, tz);

  // Last day 23:59:59.999 = midnight of first day of next month - 1ms.
  // Use start + enough days to cross into next month as a safe reference point.
  const nextMonthYear = localMonth === 12 ? localYear + 1 : localYear;
  const nextMonth = localMonth === 12 ? 1 : localMonth + 1;
  const endUtcMs = civilMidnightUtcMs(nextMonthYear, nextMonth, 1, tz) - 1;

  return { startOfMonth: new Date(startUtcMs), endOfMonth: new Date(endUtcMs) };
}
