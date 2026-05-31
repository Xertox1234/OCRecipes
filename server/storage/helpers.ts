/** Escape ILIKE metacharacters so user input is treated as literal text. */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * Returns the start (00:00:00.000) and end (23:59:59.999) of the given day,
 * computed in the specified IANA timezone (defaults to UTC).
 *
 * Using an optional `tz` param keeps all existing callers (which never passed
 * a tz) behaviorally identical — they continue to get UTC day bounds.
 *
 * Implementation uses Intl (built-in, no extra deps):
 *   1. Resolve the civil date (year/month/day) in the target tz.
 *   2. Read the UTC offset from the formatted long-offset timezone name.
 *   3. Compute start = UTC midnight of that civil date shifted by the offset.
 *
 * The offset is sampled at `date` itself, which correctly captures DST — the
 * JS Date object already knows which wall-clock offset applies at that instant.
 */
export function getDayBounds(
  date: Date,
  tz: string = "UTC",
): {
  startOfDay: Date;
  endOfDay: Date;
} {
  // Step 1: civil date in the target timezone
  const [localYear, localMonth, localDay] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number) as [number, number, number];

  // Step 2: UTC offset at this instant in the target tz, e.g. "GMT-07:00"
  const offsetPart =
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+0:00";

  const offsetMatch = offsetPart.match(/GMT([+-])(\d{1,2}):(\d{2})/);
  let offsetMinutes = 0;
  if (offsetMatch) {
    const sign = offsetMatch[1] === "+" ? 1 : -1;
    offsetMinutes =
      sign * (parseInt(offsetMatch[2], 10) * 60 + parseInt(offsetMatch[3], 10));
  }

  // Step 3: midnight in tz = UTC midnight of local date minus the UTC offset
  const startUtcMs =
    Date.UTC(localYear, localMonth - 1, localDay) - offsetMinutes * 60_000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;

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
  // Civil date in the target tz
  const [localYear, localMonth] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number) as [number, number, number];

  // UTC offset at this instant
  const offsetPart =
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+0:00";

  const offsetMatch = offsetPart.match(/GMT([+-])(\d{1,2}):(\d{2})/);
  let offsetMinutes = 0;
  if (offsetMatch) {
    const sign = offsetMatch[1] === "+" ? 1 : -1;
    offsetMinutes =
      sign * (parseInt(offsetMatch[2], 10) * 60 + parseInt(offsetMatch[3], 10));
  }

  const startUtcMs =
    Date.UTC(localYear, localMonth - 1, 1) - offsetMinutes * 60_000;

  // Last day of month: first day of next month minus 1ms
  const nextMonthYear = localMonth === 12 ? localYear + 1 : localYear;
  const nextMonth = localMonth === 12 ? 1 : localMonth + 1;
  const endUtcMs =
    Date.UTC(nextMonthYear, nextMonth - 1, 1) - offsetMinutes * 60_000 - 1;

  return { startOfMonth: new Date(startUtcMs), endOfMonth: new Date(endUtcMs) };
}
