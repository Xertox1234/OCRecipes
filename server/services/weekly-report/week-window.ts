import {
  addCivilDays,
  civilDateString,
  civilDateToInstant,
  civilHourInTz,
} from "../../lib/civil-date";

// Lives in lib/civil-date (the write cards use it too); re-exported for the
// weekly report modules that import it from here.
export { addCivilDays };

/** Hour of the local Sunday when the weekly report is written. */
export const WEEKLY_REPORT_LOCAL_HOUR = 18;

/**
 * Hours from WEEKLY_REPORT_LOCAL_HOUR during which each hourly tick tries
 * again: 18:00–21:59. Generation is idempotent per (user, week), so a later
 * tick only writes a report the 18:00 tick missed (a restart, a DB blip, a
 * throw), and a user whose generation keeps failing is tried at most four
 * times a week. It stops at 22:00 so no catch-up push lands late at night
 * (reliability audit 2026-11-19, M-rel-1).
 */
export const WEEKLY_REPORT_CATCH_UP_HOURS = 4;

/** 0 = Sunday … 6 = Saturday for a `yyyy-mm-dd` civil date. */
export function civilWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface ReportWeek {
  /** The Sunday that starts the reported week. */
  weekStart: string;
  /** The Saturday that ends it. */
  weekEnd: string;
  /** Local midnight at the start of weekStart. */
  fromUtc: Date;
  /** Local midnight at the start of the Sunday after weekEnd (exclusive). */
  toUtc: Date;
  /** True when `now` is local Sunday within the report window (18:00–21:59). */
  isReportDue: boolean;
}

/**
 * The last seven complete civil days, Sunday–Saturday, as seen in `tz`: the
 * week that ends the day before the local Sunday on or before `now`.
 */
export function reportWeekFor(now: Date, tz: string): ReportWeek {
  const today = civilDateString(now, tz);
  const weekday = civilWeekday(today);
  const thisSunday = addCivilDays(today, -weekday);
  const weekStart = addCivilDays(thisSunday, -7);
  const weekEnd = addCivilDays(thisSunday, -1);
  return {
    weekStart,
    weekEnd,
    fromUtc: civilDateToInstant(weekStart, tz),
    toUtc: civilDateToInstant(thisSunday, tz),
    isReportDue: weekday === 0 && isInReportWindow(civilHourInTz(now, tz)),
  };
}

function isInReportWindow(hour: number): boolean {
  return (
    hour >= WEEKLY_REPORT_LOCAL_HOUR &&
    hour < WEEKLY_REPORT_LOCAL_HOUR + WEEKLY_REPORT_CATCH_UP_HOURS
  );
}
