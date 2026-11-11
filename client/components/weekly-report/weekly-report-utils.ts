import type {
  WeeklyFacts,
  WeeklyRecipe,
  WeeklyReport,
  WeeklyTrendPoint,
} from "@shared/schemas/coach-weekly-report";

/**
 * Pure view-model helpers for the Coach weekly report screens. Dates here are
 * civil `yyyy-mm-dd` strings: they are read with Date.UTC as a calendar only,
 * never converted through a timezone.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return {
    month: MONTHS[m - 1],
    day: d,
    weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
  };
}

/** "Nov 1–7", or "Nov 29–Dec 5" across a month boundary. */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const a = parts(weekStart);
  const b = parts(weekEnd);
  return a.month === b.month
    ? `${a.month} ${a.day}–${b.day}`
    : `${a.month} ${a.day}–${b.month} ${b.day}`;
}

export type ChartNutrient = "protein" | "calories" | "carbs";

export interface ChartBar {
  label: string;
  value: number | null;
  met: boolean;
}

const MET_KEY = {
  protein: "proteinMet",
  calories: "caloriesMet",
  carbs: "carbsMet",
} as const;

/** One bar per day, Sunday first; null when the chart must not show. */
export function chartSeries(
  facts: WeeklyFacts,
  nutrient: ChartNutrient,
): ChartBar[] | null {
  if (facts.goals[nutrient] === null) return null;
  if (nutrient === "calories" && facts.lowCalorieGuard) return null;
  return facts.days.map((d) => ({
    label: WEEKDAY_LETTERS[parts(d.date).weekday],
    value: d[nutrient],
    met: d[MET_KEY[nutrient]] === true,
  }));
}

const NUTRIENT_ORDER: ChartNutrient[] = ["protein", "calories", "carbs"];

export function availableNutrients(facts: WeeklyFacts): ChartNutrient[] {
  return NUTRIENT_ORDER.filter((n) => chartSeries(facts, n) !== null);
}

export type TrendMetric = "proteinDays" | "daysActive" | "recipes";

export interface TrendPoint {
  weekStart: string;
  label: string;
  value: number | null;
}

/** Oldest first; the label names the month on the first bar and when it changes. */
export function trendSeries(
  trends: WeeklyTrendPoint[],
  metric: TrendMetric,
): TrendPoint[] {
  let lastMonth: string | null = null;
  return trends.map((t) => {
    const p = parts(t.weekStart);
    const label = p.month === lastMonth ? `${p.day}` : `${p.month} ${p.day}`;
    lastMonth = p.month;
    const value =
      metric === "proteinDays"
        ? t.proteinDaysMet
        : metric === "daysActive"
          ? t.daysActive
          : t.recipesAdded;
    return { weekStart: t.weekStart, label, value };
  });
}

export function shouldPlayCelebration(report: WeeklyReport): boolean {
  return report.facts.celebrate && report.celebrationShownAt === null;
}

const HOW_LABEL: Record<WeeklyRecipe["how"], string> = {
  saved: "Saved",
  favourited: "Favourited",
  imported: "Imported",
};

/** "Saved · logged twice". Logged, never "cooked": a log is all we know. */
export function recipeCaption(r: WeeklyRecipe): string {
  const logged =
    r.timesLogged === 0
      ? "not logged yet"
      : r.timesLogged === 1
        ? "logged once"
        : r.timesLogged === 2
          ? "logged twice"
          : `logged ${r.timesLogged} times`;
  return `${HOW_LABEL[r.how]} · ${logged}`;
}
