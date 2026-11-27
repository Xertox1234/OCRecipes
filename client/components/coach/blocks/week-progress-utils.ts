// client/components/coach/blocks/week-progress-utils.ts
/**
 * The week progress card (Coach roadmap T3, living blocks): the block names
 * its last day, and the card shows the calories of that day and the six
 * before it against the calorie goal as they are now, read in one request
 * that adds each day up as Home does. The block's snapshot stands in until the
 * week loads, or when it can't.
 */
import { toLocalDateString } from "@shared/lib/date";
import type { WeekCaloriesResponse } from "@/hooks/useWeekCalories";

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
 * The week's calories, once its read has come back and the latest one
 * worked, for the card's own week; otherwise nothing, so the card shows the
 * reply's seven days rather than a mix of the two.
 */
export function liveWeek(
  week: WeekCaloriesResponse | undefined,
  isError: boolean,
  endDate: string,
): number[] | undefined {
  if (!week || isError || week.endDate !== endDate) return undefined;
  if (!Array.isArray(week.calories) || week.calories.length !== 7) {
    return undefined;
  }
  return week.calories.map(num);
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

/**
 * The line under the chart, and where the goal line sits (0 to 1). While the
 * week ends today, today is left out of the average: a day still being
 * logged would pull it down.
 */
export function weekSummary(
  calories: number[],
  goal: number,
  endsToday: boolean,
): { text: string; goalAt: number } {
  const goalAt = goal / scaleOf(calories, goal);
  const counted = endsToday ? calories.slice(0, -1) : calories;
  const logged = counted.filter((c) => c > 0);
  const goalText = `goal ${whole(goal)}`;
  if (logged.length === 0) {
    const nothing = endsToday
      ? "Nothing logged before today"
      : "Nothing logged these seven days";
    return { text: `${nothing} · ${goalText}`, goalAt };
  }
  const average = logged.reduce((a, b) => a + b, 0) / logged.length;
  const days = logged.length === 1 ? "1 day" : `${logged.length} days`;
  const today = endsToday ? ", not counting today" : "";
  return {
    text: `Average ${whole(average)} cal over ${days} logged${today} · ${goalText}`,
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
