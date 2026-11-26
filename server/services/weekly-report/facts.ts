import { civilDateString, civilHourInTz } from "../../lib/civil-date";
import { MIN_SAFE_DAILY_CALORIES } from "../../lib/ai-safety";
import { addCivilDays } from "./week-window";
import type {
  WeeklyDay,
  WeeklyFacts,
  WeeklyInputs,
  WeeklyLog,
} from "@shared/schemas/coach-weekly-report";

/**
 * Pure facts builder for the Coach weekly report. Every number the report can
 * show (or that Coach may write) is decided here, once, and frozen on the row.
 * Spec: docs/superpowers/specs/2026-11-10-coach-weekly-report-design.md.
 */

export type { WeeklyInputs, WeeklyLog };

/**
 * A day counts toward "low" only with this many meals logged; a day that meets
 * a goal counts as met however many meals were logged.
 */
const FULL_DAY_MEALS = 2;
const PROTEIN_MET_RATIO = 0.9;
const RANGE_TOLERANCE = 0.1;
const LOW_CALORIE_RATIO = 0.7;
const LATE_DINNER_HOUR = 21;
const MIN_PATTERN_COUNT = 2;
/**
 * Recipes kept in the facts. The list goes into the AI prompt, the stored row
 * and every report response, so a week of bulk saves must not grow them
 * without end (coach audit 2026-11-24, L69). recipesAdded keeps the true count.
 */
const MAX_RECIPES = 12;

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((a, b) => a + b, 0));
}

function proteinMet(value: number | null, goal: number | null): boolean | null {
  if (goal === null) return null;
  return value !== null && value >= PROTEIN_MET_RATIO * goal;
}

function inRange(value: number | null, goal: number | null): boolean | null {
  if (goal === null) return null;
  return value !== null && Math.abs(value - goal) <= RANGE_TOLERANCE * goal;
}

function countTrue(days: WeeklyDay[], key: keyof WeeklyDay): number {
  return days.filter((d) => d[key] === true).length;
}

/**
 * Up to three neutral patterns. Wording never says "skipped": a missing log is
 * not a skipped meal. Lunch is judged only on days whose meals were tagged.
 */
export function buildPatterns(
  days: WeeklyDay[],
  logs: WeeklyLog[],
  tz: string,
): string[] {
  const patterns: string[] = [];
  const byDay = new Map<string, WeeklyLog[]>();
  for (const l of logs) {
    const d = civilDateString(l.loggedAt, tz);
    byDay.set(d, [...(byDay.get(d) ?? []), l]);
  }

  const taggedDays = days
    .map((d) => byDay.get(d.date) ?? [])
    .filter((ls) => ls.some((l) => l.mealType !== null));
  const noLunch = taggedDays.filter(
    (ls) => !ls.some((l) => l.mealType === "lunch"),
  ).length;
  if (noLunch >= MIN_PATTERN_COUNT) {
    patterns.push(`no lunch logged on ${noLunch} days`);
  }

  const lateDinners = logs.filter(
    (l) =>
      l.mealType === "dinner" &&
      civilHourInTz(l.loggedAt, tz) >= LATE_DINNER_HOUR,
  ).length;
  if (lateDinners >= MIN_PATTERN_COUNT) {
    patterns.push(`dinner logged after 9 pm ${lateDinners} times`);
  }

  const breakfastDays = taggedDays.filter((ls) =>
    ls.some((l) => l.mealType === "breakfast"),
  ).length;
  if (breakfastDays >= 3 && breakfastDays === taggedDays.length) {
    patterns.push(`breakfast logged on all ${breakfastDays} days you logged`);
  }

  return patterns.slice(0, 3);
}

export function buildWeeklyFacts(
  inputs: WeeklyInputs,
  week: { weekStart: string; weekEnd: string },
  tz: string,
  safetySignal: boolean,
): WeeklyFacts {
  const { goals } = inputs;
  const dates = Array.from({ length: 7 }, (_, i) =>
    addCivilDays(week.weekStart, i),
  );

  const days: WeeklyDay[] = dates.map((date) => {
    const ls = inputs.logs.filter(
      (l) => civilDateString(l.loggedAt, tz) === date,
    );
    const calories = sumOrNull(ls.map((l) => l.calories));
    const protein = sumOrNull(ls.map((l) => l.protein));
    const carbs = sumOrNull(ls.map((l) => l.carbs));
    // A verdict is known only when every logged meal recorded the nutrient.
    // None recorded (reliability audit 2026-11-19, L-xc-7) or only some
    // (coach audit 2026-11-24, L23): the total is missing or too low, so the
    // day is unknown, not a missed target. A day with no meals stays "not met".
    // A partial total is still a floor: protein already at the goal is met.
    const met = (
      key: "calories" | "protein" | "carbs",
      check: boolean | null,
      floorCounts: boolean,
    ): boolean | null => {
      const unrecorded = ls.filter((l) => l[key] === null).length;
      if (unrecorded === 0) return check;
      if (floorCounts && check === true && unrecorded < ls.length) return true;
      return null;
    };
    return {
      date,
      meals: ls.length,
      calories,
      protein,
      carbs,
      fullyLogged: ls.length >= FULL_DAY_MEALS,
      proteinMet: met("protein", proteinMet(protein, goals.protein), true),
      caloriesMet: met("calories", inRange(calories, goals.calories), false),
      carbsMet: met("carbs", inRange(carbs, goals.carbs), false),
    };
  });

  const daysActive = days.filter((d) => d.meals > 0).length;
  const proteinDaysMet =
    goals.protein === null ? null : countTrue(days, "proteinMet");
  const caloriesDaysMet =
    goals.calories === null ? null : countTrue(days, "caloriesMet");
  const carbsDaysMet =
    goals.carbs === null ? null : countTrue(days, "carbsMet");

  // With no calorie goal the safety floor stands in for it, so the guard does
  // not hang on a profile field the user may leave blank (coach audit
  // 2026-11-24, L22). A partial day's total is too low, which can only set the
  // guard, never clear it: the safe side.
  const lowLine =
    goals.calories !== null
      ? LOW_CALORIE_RATIO * goals.calories
      : MIN_SAFE_DAILY_CALORIES;
  const full = days.filter((d) => d.fullyLogged && d.calories !== null);
  const low = full.filter((d) => (d.calories as number) < lowLine);
  const lowCalorieGuard = full.length > 0 && low.length > full.length / 2;

  const previous = inputs.previous.slice(0, 6);
  const last = previous[0] ?? null;
  const lastWeek = last
    ? {
        daysActive: last.daysActive,
        proteinDaysMet: last.proteinDaysMet,
        mealsLogged: last.mealsLogged,
      }
    : null;

  let best: WeeklyFacts["best"] = null;
  if (previous.length > 0) {
    const all = [...previous, { proteinDaysMet, daysActive }];
    const proteins = all
      .map((w) => w.proteinDaysMet)
      .filter((p): p is number => p !== null);
    best = {
      proteinDaysMet: proteins.length > 0 ? Math.max(...proteins) : null,
      daysActive: Math.max(...all.map((w) => w.daysActive)),
    };
  }

  const trend = previous
    .slice(0, 5)
    .reverse()
    .map((w) => ({
      weekStart: w.weekStart,
      proteinDaysMet: w.proteinDaysMet,
      daysActive: w.daysActive,
      recipesAdded: w.recipesAdded,
    }));

  return {
    version: 1,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    goals: { ...goals },
    days,
    daysActive,
    mealsLogged: inputs.logs.length,
    recipesAdded: inputs.recipes.length,
    proteinDaysMet,
    caloriesDaysMet,
    carbsDaysMet,
    // Never celebrate a guarded week: low intake is not a win, and a safety
    // signal week gets gentle copy only.
    celebrate:
      !safetySignal &&
      !lowCalorieGuard &&
      ((proteinDaysMet ?? 0) >= 5 || daysActive === 7),
    lowCalorieGuard,
    safetySignal,
    recipes: inputs.recipes.slice(0, MAX_RECIPES),
    patterns: buildPatterns(days, inputs.logs, tz),
    lastWeek,
    best,
    trend,
    tipIds: inputs.tipIds.slice(0, 3),
    quiet: daysActive <= 2,
  };
}
