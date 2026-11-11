import { describe, it, expect } from "vitest";
import {
  availableNutrients,
  chartSeries,
  formatWeekRange,
  recipeCaption,
  shouldPlayCelebration,
  trendSeries,
} from "../weekly-report-utils";
import type {
  WeeklyDay,
  WeeklyFacts,
  WeeklyRecipe,
  WeeklyReport,
} from "@shared/schemas/coach-weekly-report";

const DATES = [1, 2, 3, 4, 5, 6, 7].map((d) => `2026-11-0${d}`); // Sun..Sat

const day = (date: string, v: Partial<WeeklyDay> = {}): WeeklyDay => ({
  date,
  meals: 2,
  calories: 2000,
  protein: 100,
  carbs: 200,
  fullyLogged: true,
  proteinMet: false,
  caloriesMet: true,
  carbsMet: null,
  ...v,
});

function facts(over: Partial<WeeklyFacts> = {}): WeeklyFacts {
  return {
    version: 1,
    weekStart: "2026-11-01",
    weekEnd: "2026-11-07",
    goals: { calories: 2000, protein: 120, carbs: null },
    days: DATES.map((d, i) => day(d, { proteinMet: i === 0 })),
    daysActive: 7,
    mealsLogged: 14,
    recipesAdded: 0,
    proteinDaysMet: 1,
    caloriesDaysMet: 7,
    carbsDaysMet: null,
    celebrate: false,
    lowCalorieGuard: false,
    safetySignal: false,
    recipes: [],
    patterns: [],
    lastWeek: null,
    best: null,
    trend: [],
    tipIds: [],
    quiet: false,
    ...over,
  };
}

describe("formatWeekRange", () => {
  it("formats a week inside one month", () => {
    expect(formatWeekRange("2026-11-01", "2026-11-07")).toBe("Nov 1–7");
  });
  it("formats a week across two months", () => {
    expect(formatWeekRange("2026-10-25", "2026-10-31")).toBe("Oct 25–31");
    expect(formatWeekRange("2026-11-29", "2026-12-05")).toBe("Nov 29–Dec 5");
  });
});

describe("chartSeries", () => {
  it("gives one bar per day, Sunday first, with the met flag", () => {
    const s = chartSeries(facts(), "protein");
    expect(s?.map((b) => b.label)).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
    expect(s?.[0]).toEqual({ label: "S", value: 100, met: true });
    expect(s?.[1].met).toBe(false);
  });

  it("is null when the goal is missing", () => {
    expect(chartSeries(facts(), "carbs")).toBeNull();
  });

  it("hides calories under the low-calorie guard", () => {
    expect(
      chartSeries(facts({ lowCalorieGuard: true }), "calories"),
    ).toBeNull();
    expect(
      chartSeries(facts({ lowCalorieGuard: true }), "protein"),
    ).not.toBeNull();
  });

  it("availableNutrients lists only the charts that can show", () => {
    expect(availableNutrients(facts())).toEqual(["protein", "calories"]);
    expect(availableNutrients(facts({ lowCalorieGuard: true }))).toEqual([
      "protein",
    ]);
  });
});

describe("trendSeries", () => {
  const trends = [
    {
      weekStart: "2026-10-04",
      proteinDaysMet: 1,
      daysActive: 3,
      recipesAdded: 0,
    },
    {
      weekStart: "2026-10-11",
      proteinDaysMet: null,
      daysActive: 4,
      recipesAdded: 2,
    },
    {
      weekStart: "2026-11-01",
      proteinDaysMet: 5,
      daysActive: 7,
      recipesAdded: 1,
    },
  ];

  it("maps a metric with short labels that name the month when it changes", () => {
    expect(trendSeries(trends, "proteinDays")).toEqual([
      { weekStart: "2026-10-04", label: "Oct 4", value: 1 },
      { weekStart: "2026-10-11", label: "11", value: null },
      { weekStart: "2026-11-01", label: "Nov 1", value: 5 },
    ]);
    expect(trendSeries(trends, "daysActive").map((p) => p.value)).toEqual([
      3, 4, 7,
    ]);
    expect(trendSeries(trends, "recipes").map((p) => p.value)).toEqual([
      0, 2, 1,
    ]);
  });
});

describe("shouldPlayCelebration", () => {
  const report = (celebrate: boolean, shown: string | null): WeeklyReport => ({
    id: 1,
    weekStart: "2026-11-01",
    weekEnd: "2026-11-07",
    facts: facts({ celebrate }),
    content: {
      headline: "h",
      wins: [],
      watch: [],
      next: null,
      fromLogged: null,
      trendLine: null,
    },
    seenAt: null,
    celebrationShownAt: shown,
    deliveredVia: null,
  });

  it("plays once, only for a celebration week", () => {
    expect(shouldPlayCelebration(report(true, null))).toBe(true);
    expect(shouldPlayCelebration(report(true, "2026-11-08T19:00:00Z"))).toBe(
      false,
    );
    expect(shouldPlayCelebration(report(false, null))).toBe(false);
  });
});

describe("recipeCaption", () => {
  const r = (how: WeeklyRecipe["how"], timesLogged: number): WeeklyRecipe => ({
    recipeId: 1,
    recipeType: "mealPlan",
    title: "Stew",
    how,
    timesLogged,
    imageUrl: null,
  });

  it("names how it was added and how often it was logged, never 'cooked'", () => {
    expect(recipeCaption(r("saved", 2))).toBe("Saved · logged twice");
    expect(recipeCaption(r("saved", 0))).toBe("Saved · not logged yet");
    expect(recipeCaption(r("favourited", 1))).toBe("Favourited · logged once");
    expect(recipeCaption(r("imported", 3))).toBe("Imported · logged 3 times");
  });
});
