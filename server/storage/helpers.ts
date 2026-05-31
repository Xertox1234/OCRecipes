/** Escape ILIKE metacharacters so user input is treated as literal text. */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * Read the UTC offset (in minutes) at a specific UTC timestamp in a given
 * IANA timezone. Returns 0 for UTC or on parse failure.
 *
 * Intl produces strings like "GMT-07:00", "GMT+05:30", "GMT" (for UTC).
 */
function getOffsetMinutesAt(utcMs: number, tz: string): number {
  const offsetStr =
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(utcMs))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+0:00";

  const match = offsetStr.match(/GMT([+-])(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
}

/**
 * Compute the UTC instant that corresponds to local midnight on a given civil
 * date in `tz`, correctly handling DST transitions.
 *
 * Algorithm (two-step offset correction):
 * 1. Guess: treat `Date.UTC(y, m-1, d)` as a first approximation.
 * 2. Read the tz offset at that guess → compute candidate midnight.
 * 3. Re-read the tz offset at the candidate → if it differs from step 2,
 *    one more correction produces the correct midnight.
 *
 * This handles the spring-forward edge case where the offset sampled at an
 * arbitrary input time differs from the offset at civil midnight (e.g. a 1pm
 * PDT reading gives -7h but midnight on the same spring-forward day is PST at
 * -8h). Without this correction getDayBounds is off by 1h on transition days.
 */
function civilMidnightUtcMs(
  year: number,
  month: number, // 1-based
  day: number,
  tz: string,
): number {
  const guessMs = Date.UTC(year, month - 1, day);
  const off1 = getOffsetMinutesAt(guessMs, tz);
  const candidateMs = guessMs - off1 * 60_000;
  const off2 = getOffsetMinutesAt(candidateMs, tz);
  return off2 !== off1 ? guessMs - off2 * 60_000 : candidateMs;
}

/**
 * Returns the start (00:00:00.000) and end (23:59:59.999) of the given day,
 * computed in the specified IANA timezone (defaults to UTC).
 *
 * Using an optional `tz` param keeps all existing callers (which never passed
 * a tz) behaviorally identical — they continue to get UTC day bounds.
 *
 * DST correctness: uses a two-step offset correction via `civilMidnightUtcMs`
 * so that spring-forward / fall-back days are bounded correctly (not off by 1h).
 * The "end of day" is the start of the *next* calendar day minus 1ms, which
 * correctly handles 23h (spring-forward) and 25h (fall-back) days.
 *
 * To find "tomorrow", this adds 25 hours to the start (enough to always land
 * in the next local day even on DST-transition days) and reads its civil date.
 */
export function getDayBounds(
  date: Date,
  tz: string = "UTC",
): {
  startOfDay: Date;
  endOfDay: Date;
} {
  // Civil date in the target timezone
  const civilFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [localYear, localMonth, localDay] = civilFmt
    .format(date)
    .split("-")
    .map(Number) as [number, number, number];

  const startUtcMs = civilMidnightUtcMs(localYear, localMonth, localDay, tz);

  // "Tomorrow" in the local tz: add 25h to the start so we always land in the
  // next calendar day regardless of DST (shortest local day is 23h).
  const tomorrowRef = new Date(startUtcMs + 25 * 60 * 60 * 1000);
  const [nextYear, nextMonth, nextDay] = civilFmt
    .format(tomorrowRef)
    .split("-")
    .map(Number) as [number, number, number];

  const endUtcMs = civilMidnightUtcMs(nextYear, nextMonth, nextDay, tz) - 1;

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
  const [localYear, localMonth] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
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
