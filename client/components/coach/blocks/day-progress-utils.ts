// client/components/coach/blocks/day-progress-utils.ts
/**
 * The day progress card (Coach roadmap T3, living blocks): the block names a
 * day, and the card shows that day's totals against the goals as they are
 * now, from the same queries Home reads. The block's snapshot stands in until
 * those load, or when they can't.
 */
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
import type { DayTotals } from "@shared/schemas/coach-blocks";
import { toLocalDateString } from "@shared/lib/date";
import type { DailySummaryResponse, GoalsResponse } from "@/types/api";

export interface DayProgressRow {
  label: string;
  /** "1,420 / 2,000 cal" */
  text: string;
  /** How full the bar is, 0 to 1. */
  fraction: number;
  over: boolean;
  /** For VoiceOver: "Protein: 82 of 150 grams". */
  spoken: string;
}

const ROWS = [
  { key: "calories", label: "Calories", unit: "cal", unitWord: "" },
  { key: "protein", label: "Protein", unit: "g", unitWord: " grams" },
  { key: "carbs", label: "Carbs", unit: "g", unitWord: " grams" },
  { key: "fat", label: "Fat", unit: "g", unitWord: " grams" },
] as const;

/** 1420.4 → "1,420". */
function whole(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function dayProgressRows(
  totals: DayTotals,
  goals: DayTotals,
): DayProgressRow[] {
  return ROWS.map(({ key, label, unit, unitWord }) => {
    const value = totals[key];
    const goal = goals[key];
    const over = goal > 0 && Math.round(value) > Math.round(goal);
    const fraction =
      goal > 0 ? Math.min(Math.round((value / goal) * 100) / 100, 1) : 0;
    return {
      label,
      text: `${whole(value)} / ${whole(goal)} ${unit}`,
      fraction,
      over,
      spoken: `${label}: ${whole(value)} of ${whole(goal)}${unitWord}${over ? ", over the goal" : ""}`,
    };
  });
}

/** A total as a number: a sum can arrive as a string. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The day's totals from /api/daily-summary, once it has loaded. */
export function liveTotals(
  summary: DailySummaryResponse | undefined,
): DayTotals | undefined {
  if (!summary) return undefined;
  return {
    calories: num(summary.totalCalories),
    protein: num(summary.totalProtein),
    carbs: num(summary.totalCarbs),
    fat: num(summary.totalFat),
  };
}

/**
 * The goals from /api/goals, an unset one (null or 0) as its default: the
 * same fallback the server used for the snapshot (server/services/day-progress.ts).
 */
export function liveGoals(
  goals: GoalsResponse | undefined,
): DayTotals | undefined {
  if (!goals) return undefined;
  return {
    calories: goals.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories,
    protein: goals.dailyProteinGoal || DEFAULT_NUTRITION_GOALS.protein,
    carbs: goals.dailyCarbsGoal || DEFAULT_NUTRITION_GOALS.carbs,
    fat: goals.dailyFatGoal || DEFAULT_NUTRITION_GOALS.fat,
  };
}

function localDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Today so far", "Yesterday", or the date: `today` is the phone's day. */
export function dayProgressTitle(date: string, today: string): string {
  if (date === today) return "Today so far";
  const before = localDate(today);
  before.setDate(before.getDate() - 1);
  if (date === toLocalDateString(before)) return "Yesterday";
  return localDate(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function dayProgressSpoken(
  title: string,
  rows: DayProgressRow[],
  live: boolean,
): string {
  return [title, ...rows.map((r) => r.spoken)]
    .concat(live ? [] : ["As of the Coach's reply"])
    .join(". ")
    .concat(".");
}
