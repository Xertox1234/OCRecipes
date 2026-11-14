import {
  civilDateString,
  civilDateToInstant,
  civilHourInTz,
} from "../../lib/civil-date";

/** Hour of the local Sunday when the weekly report is written. */
export const WEEKLY_REPORT_LOCAL_HOUR = 18;

/** Add whole days to a `yyyy-mm-dd` civil date (calendar maths, no tz). */
export function addCivilDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

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
  /** True when `now` is local Sunday in the report hour. */
  isSundayEvening: boolean;
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
    isSundayEvening:
      weekday === 0 && civilHourInTz(now, tz) === WEEKLY_REPORT_LOCAL_HOUR,
  };
}
