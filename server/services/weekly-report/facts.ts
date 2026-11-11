import { civilDateString, civilHourInTz } from "../../lib/civil-date";
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
    return {
      date,
      meals: ls.length,
      calories,
      protein,
      carbs,
      fullyLogged: ls.length >= FULL_DAY_MEALS,
      proteinMet: proteinMet(protein, goals.protein),
      caloriesMet: inRange(calories, goals.calories),
      carbsMet: inRange(carbs, goals.carbs),
    };
  });

  const daysActive = days.filter((d) => d.meals > 0).length;
  const proteinDaysMet =
    goals.protein === null ? null : countTrue(days, "proteinMet");
  const caloriesDaysMet =
    goals.calories === null ? null : countTrue(days, "caloriesMet");
  const carbsDaysMet =
    goals.carbs === null ? null : countTrue(days, "carbsMet");

  let lowCalorieGuard = false;
  if (goals.calories !== null) {
    const full = days.filter((d) => d.fullyLogged && d.calories !== null);
    const low = full.filter(
      (d) =>
        (d.calories as number) < LOW_CALORIE_RATIO * (goals.calories as number),
    );
    lowCalorieGuard = full.length > 0 && low.length > full.length / 2;
  }

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
    recipes: inputs.recipes,
    patterns: buildPatterns(days, inputs.logs, tz),
    lastWeek,
    best,
    trend,
    tipIds: inputs.tipIds.slice(0, 3),
    quiet: daysActive <= 2,
  };
}
