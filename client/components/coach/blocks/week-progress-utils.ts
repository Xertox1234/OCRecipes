// client/components/coach/blocks/week-progress-utils.ts
/**
 * The week progress card (Coach roadmap T3, living blocks): the block names
 * its last day, and the card shows the calories of that day and the six
 * before it against the calorie goal as they are now, from the same day
 * reads Home and the day card make. The block's snapshot stands in until all
 * seven load, or when one can't.
 */
import { toLocalDateString } from "@shared/lib/date";
import type { DailySummaryResponse } from "@/types/api";

export interface WeekBar {
  date: string;
  /** "Fri", or "Today". */
  label: string;
  /** "1,850", or "—" for a day with nothing logged. */
  text: string;
  value: number;
  /** The bar's height, 0 to 1 of the chart. */
  height: number;
  over: boolean;
  logged: boolean;
  /** For VoiceOver: "Friday: 1,850 calories". */
  spoken: string;
}

/** 1420.4 → "1,420". */
function whole(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function localDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The last day and the six before it, oldest first. */
export function weekDates(endDate: string): string[] {
  return [6, 5, 4, 3, 2, 1, 0].map((back) => {
    // setDate moves a local date by calendar days, so a clock change can't
    // skip or repeat one.
    const d = localDate(endDate);
    d.setDate(d.getDate() - back);
    return toLocalDateString(d);
  });
}

/** A total as a number: a sum can arrive as a string. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Each day's calories, once all seven reads have come back and the latest of
 * each worked; otherwise nothing, so the card shows the reply's seven days
 * rather than a mix of the two.
 */
export function liveWeek(
  reads: { data?: DailySummaryResponse; isError: boolean }[],
): number[] | undefined {
  if (reads.some((r) => !r.data || r.isError)) return undefined;
  return reads.map((r) => num(r.data?.totalCalories));
}

function scaleOf(calories: number[], goal: number): number {
  return Math.max(goal, ...calories);
}

export function weekBars(
  calories: number[],
  goal: number,
  dates: string[],
  today: string,
): WeekBar[] {
  const scale = scaleOf(calories, goal);
  return calories.map((value, i) => {
    const date = dates[i];
    const isToday = date === today;
    const d = localDate(date);
    const label = isToday
      ? "Today"
      : d.toLocaleDateString("en-US", { weekday: "short" });
    const spokenDay = isToday
      ? "Today"
      : d.toLocaleDateString("en-US", { weekday: "long" });
    const logged = value > 0;
    const over = Math.round(value) > Math.round(goal);
    return {
      date,
      label,
      text: logged ? whole(value) : "—",
      value,
      height: scale > 0 ? Math.round((value / scale) * 100) / 100 : 0,
      over,
      logged,
      spoken: logged
        ? `${spokenDay}: ${whole(value)} calories${over ? ", over the goal" : ""}`
        : `${spokenDay}: nothing logged`,
    };
  });
}

/** The line under the chart, and where the goal line sits (0 to 1). */
export function weekSummary(
  calories: number[],
  goal: number,
): { text: string; goalAt: number } {
  const goalAt = goal / scaleOf(calories, goal);
  const logged = calories.filter((c) => c > 0);
  const goalText = `goal ${whole(goal)}`;
  if (logged.length === 0) {
    return { text: `Nothing logged these seven days · ${goalText}`, goalAt };
  }
  const average = logged.reduce((a, b) => a + b, 0) / logged.length;
  const days = logged.length === 1 ? "1 day" : `${logged.length} days`;
  return {
    text: `Average ${whole(average)} cal over ${days} logged · ${goalText}`,
    goalAt,
  };
}

/** "Last 7 days" when the week ends today (the phone's day), else its end. */
export function weekTitle(endDate: string, today: string): string {
  if (endDate === today) return "Last 7 days";
  const end = localDate(endDate).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `7 days to ${end}`;
}

export function weekSpoken(
  title: string,
  bars: WeekBar[],
  summary: string,
  live: boolean,
): string {
  return [title, ...bars.map((b) => b.spoken), summary]
    .concat(live ? [] : ["As of the Coach's reply"])
    .join(". ")
    .concat(".");
}
