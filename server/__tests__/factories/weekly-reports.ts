import type { CoachWeeklyReport } from "@shared/schema";
import type {
  WeeklyDay,
  WeeklyFacts,
  WeeklyReportContent,
} from "@shared/schemas/coach-weekly-report";

const emptyDay = (date: string): WeeklyDay => ({
  date,
  meals: 0,
  calories: null,
  protein: null,
  carbs: null,
  fullyLogged: false,
  proteinMet: false,
  caloriesMet: false,
  carbsMet: null,
});

/** A valid, empty Sunday–Saturday week (2026-11-01..07); override what a test needs. */
export function createMockWeeklyFacts(
  overrides: Partial<WeeklyFacts> = {},
): WeeklyFacts {
  return {
    version: 1,
    weekStart: "2026-11-01",
    weekEnd: "2026-11-07",
    goals: { calories: 2000, protein: 120, carbs: null },
    days: [1, 2, 3, 4, 5, 6, 7].map((d) => emptyDay(`2026-11-0${d}`)),
    daysActive: 0,
    mealsLogged: 0,
    recipesAdded: 0,
    proteinDaysMet: 0,
    caloriesDaysMet: 0,
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
    quiet: true,
    ...overrides,
  };
}

export function createMockWeeklyReportContent(
  overrides: Partial<WeeklyReportContent> = {},
): WeeklyReportContent {
  return {
    headline: "A lighter week for logging, and that's fine.",
    wins: [],
    watch: [],
    next: null,
    fromLogged: null,
    trendLine: null,
    ...overrides,
  };
}

export function createMockWeeklyReport(
  overrides: Partial<CoachWeeklyReport> = {},
): CoachWeeklyReport {
  return {
    id: 1,
    userId: "1",
    weekStart: "2026-11-01",
    weekEnd: "2026-11-07",
    facts: createMockWeeklyFacts(),
    content: createMockWeeklyReportContent(),
    source: "template",
    createdAt: new Date("2026-11-08T18:00:00Z"),
    seenAt: null,
    celebrationShownAt: null,
    pushDueAt: null,
    deliveredVia: null,
    deliveredAt: null,
    ...overrides,
  };
}
