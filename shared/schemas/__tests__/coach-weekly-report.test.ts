import { describe, it, expect } from "vitest";
import {
  weeklyFactsSchema,
  weeklyReportContentSchema,
  type WeeklyFacts,
} from "../coach-weekly-report";

const day = (date: string) => ({
  date,
  meals: 3,
  calories: 1950,
  protein: 110,
  carbs: 200,
  fullyLogged: true,
  proteinMet: true,
  caloriesMet: true,
  carbsMet: true,
});

export const factsFixture: WeeklyFacts = {
  version: 1,
  weekStart: "2026-11-01",
  weekEnd: "2026-11-07",
  goals: { calories: 2000, protein: 120, carbs: 220 },
  days: [
    "2026-11-01",
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
  ].map(day),
  daysActive: 7,
  mealsLogged: 21,
  recipesAdded: 1,
  proteinDaysMet: 7,
  caloriesDaysMet: 7,
  carbsDaysMet: 7,
  celebrate: true,
  lowCalorieGuard: false,
  safetySignal: false,
  recipes: [
    {
      recipeId: 12,
      recipeType: "mealPlan",
      title: "Lentil stew",
      how: "saved",
      timesLogged: 2,
      imageUrl: null,
    },
  ],
  patterns: ["no lunch logged on 2 days"],
  lastWeek: { daysActive: 5, proteinDaysMet: 4, mealsLogged: 14 },
  best: { proteinDaysMet: 7, daysActive: 7 },
  trend: [
    {
      weekStart: "2026-10-25",
      proteinDaysMet: 4,
      daysActive: 5,
      recipesAdded: 0,
    },
  ],
  tipIds: ["pantry"],
  quiet: false,
};

describe("weeklyFactsSchema", () => {
  it("accepts a full week fixture", () => {
    expect(weeklyFactsSchema.safeParse(factsFixture).success).toBe(true);
  });

  it("rejects a week that is not seven days", () => {
    const bad = { ...factsFixture, days: factsFixture.days.slice(0, 6) };
    expect(weeklyFactsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a fibre key (no fibre anywhere)", () => {
    const bad = { ...factsFixture, fibreDaysMet: 3 };
    expect(weeklyFactsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown tip id", () => {
    const bad = { ...factsFixture, tipIds: ["teleport"] };
    expect(weeklyFactsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("weeklyReportContentSchema", () => {
  const content = {
    headline: "Protein on target 7 of 7 days.",
    wins: ["You showed up every day."],
    watch: [],
    next: null,
    fromLogged: null,
    trendLine: null,
  };

  it("accepts valid content", () => {
    expect(weeklyReportContentSchema.safeParse(content).success).toBe(true);
  });

  it("rejects three wins", () => {
    const bad = { ...content, wins: ["a", "b", "c"] };
    expect(weeklyReportContentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a 121-character headline", () => {
    const bad = { ...content, headline: "x".repeat(121) };
    expect(weeklyReportContentSchema.safeParse(bad).success).toBe(false);
  });
});
