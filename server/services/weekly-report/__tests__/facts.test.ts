import { describe, it, expect } from "vitest";
import { buildWeeklyFacts, type WeeklyInputs } from "../facts";
import type { WeeklyFacts } from "@shared/schemas/coach-weekly-report";
import { weeklyFactsSchema } from "@shared/schemas/coach-weekly-report";

const TZ = "UTC";
const WEEK = { weekStart: "2026-11-01", weekEnd: "2026-11-07" };
const DATES = [
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
];
const BANNED =
  /\b(missed|failed|only|broken|behind|skipped|didn't eat|deficit|weight|lose|streak)\b/i;

type Log = WeeklyInputs["logs"][number];
const log = (date: string, hour: number, v: Partial<Log> = {}): Log => ({
  loggedAt: new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`),
  mealType: null,
  calories: null,
  protein: null,
  carbs: null,
  ...v,
});

function inputs(over: Partial<WeeklyInputs> = {}): WeeklyInputs {
  return {
    goals: { calories: 2000, protein: 120, carbs: 220 },
    logs: [],
    recipes: [],
    previous: [],
    coachMessages: [],
    tipIds: [],
    ...over,
  };
}

/** Two meals splitting a day's totals. */
const twoMeals = (date: string, t: { calories?: number; protein?: number }) => [
  log(date, 8, {
    calories: t.calories !== undefined ? t.calories / 2 : null,
    protein: t.protein !== undefined ? t.protein / 2 : null,
  }),
  log(date, 18, {
    calories: t.calories !== undefined ? t.calories / 2 : null,
    protein: t.protein !== undefined ? t.protein / 2 : null,
  }),
];

const facts = (over: Partial<WeeklyInputs> = {}, safety = false) =>
  buildWeeklyFacts(inputs(over), WEEK, TZ, safety);

describe("buildWeeklyFacts — protein rule", () => {
  it("108 g on a 120 g goal with two meals is met; 107 g is not", () => {
    const f = facts({
      logs: [
        ...twoMeals(DATES[0], { protein: 108 }),
        ...twoMeals(DATES[1], { protein: 107 }),
      ],
    });
    expect(f.days[0].proteinMet).toBe(true);
    expect(f.days[1].proteinMet).toBe(false);
    expect(f.proteinDaysMet).toBe(1);
  });

  it("a one-meal day is logged but not fully logged, and never counts as low", () => {
    const f = facts({
      logs: [log(DATES[0], 12, { protein: 60, calories: 500 })],
    });
    expect(f.days[0].meals).toBe(1);
    expect(f.days[0].fullyLogged).toBe(false);
    expect(f.days[0].proteinMet).toBe(false);
    expect(f.lowCalorieGuard).toBe(false);
  });

  it("a one-meal day that meets the goal anyway counts as met", () => {
    const f = facts({ logs: [log(DATES[0], 12, { protein: 125 })] });
    expect(f.days[0].proteinMet).toBe(true);
    expect(f.proteinDaysMet).toBe(1);
  });
});

describe("buildWeeklyFacts — calorie rule (±10%)", () => {
  it("1800 and 2200 are met; 1799 and 2201 are not", () => {
    const f = facts({
      logs: [
        ...twoMeals(DATES[0], { calories: 1800 }),
        ...twoMeals(DATES[1], { calories: 2200 }),
        ...twoMeals(DATES[2], { calories: 1799 }),
        ...twoMeals(DATES[3], { calories: 2201 }),
      ],
    });
    expect(f.days.slice(0, 4).map((d) => d.caloriesMet)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(f.caloriesDaysMet).toBe(2);
  });
});

describe("buildWeeklyFacts — celebration", () => {
  it("5 protein days celebrates", () => {
    const logs = DATES.slice(0, 5).flatMap((d) =>
      twoMeals(d, { protein: 130 }),
    );
    expect(facts({ logs }).celebrate).toBe(true);
  });

  it("4 protein days with 7 days active celebrates", () => {
    const logs = [
      ...DATES.slice(0, 4).flatMap((d) => twoMeals(d, { protein: 130 })),
      ...DATES.slice(4).flatMap((d) => twoMeals(d, { protein: 50 })),
    ];
    const f = facts({ logs });
    expect(f.daysActive).toBe(7);
    expect(f.celebrate).toBe(true);
  });

  it("4 protein days with 6 days active does not celebrate", () => {
    const logs = [
      ...DATES.slice(0, 4).flatMap((d) => twoMeals(d, { protein: 130 })),
      ...DATES.slice(4, 6).flatMap((d) => twoMeals(d, { protein: 50 })),
    ];
    expect(facts({ logs }).celebrate).toBe(false);
  });

  it("no protein goal: proteinDaysMet is null and only 7 days active celebrates", () => {
    const goals = { calories: 2000, protein: null, carbs: null };
    const six = DATES.slice(0, 6).flatMap((d) => twoMeals(d, { protein: 130 }));
    const f6 = facts({ goals, logs: six });
    expect(f6.proteinDaysMet).toBeNull();
    expect(f6.days[0].proteinMet).toBeNull();
    expect(f6.carbsDaysMet).toBeNull();
    expect(f6.celebrate).toBe(false);
    const seven = DATES.flatMap((d) => twoMeals(d, { protein: 130 }));
    expect(facts({ goals, logs: seven }).celebrate).toBe(true);
  });
});

describe("buildWeeklyFacts — no celebration on a guarded week", () => {
  const seven = () =>
    DATES.flatMap((d) => twoMeals(d, { protein: 130, calories: 2000 }));
  it("a safety signal turns the celebration off", () => {
    expect(facts({ logs: seven() }).celebrate).toBe(true);
    expect(facts({ logs: seven() }, true).celebrate).toBe(false);
  });
  it("the low-calorie guard turns the celebration off", () => {
    const low = DATES.flatMap((d) =>
      twoMeals(d, { protein: 130, calories: 1000 }),
    );
    const f = facts({ logs: low });
    expect(f.lowCalorieGuard).toBe(true);
    expect(f.celebrate).toBe(false);
  });
});

describe("buildWeeklyFacts — low-calorie guard", () => {
  it("4 of 6 fully logged days under 1400 kcal on a 2000 goal sets the guard", () => {
    const logs = [
      ...DATES.slice(0, 4).flatMap((d) => twoMeals(d, { calories: 1200 })),
      ...DATES.slice(4, 6).flatMap((d) => twoMeals(d, { calories: 2000 })),
    ];
    expect(facts({ logs }).lowCalorieGuard).toBe(true);
  });

  it("3 of 6 is not more than half", () => {
    const logs = [
      ...DATES.slice(0, 3).flatMap((d) => twoMeals(d, { calories: 1200 })),
      ...DATES.slice(3, 6).flatMap((d) => twoMeals(d, { calories: 2000 })),
    ];
    expect(facts({ logs }).lowCalorieGuard).toBe(false);
  });
});

describe("buildWeeklyFacts — comparisons", () => {
  const prev = (
    weekStart: string,
    p: number | null,
    active: number,
  ): WeeklyFacts => ({
    ...buildWeeklyFacts(inputs(), { weekStart, weekEnd: weekStart }, TZ, false),
    weekStart,
    proteinDaysMet: p,
    daysActive: active,
    mealsLogged: active * 2,
    recipesAdded: 1,
  });

  it("fills lastWeek, best and an oldest-first trend of at most 5", () => {
    const previous = [
      prev("2026-10-25", 3, 4),
      prev("2026-10-18", 6, 5),
      prev("2026-10-11", 1, 2),
      prev("2026-10-04", 2, 3),
      prev("2026-09-27", 2, 3),
      prev("2026-09-20", 0, 1),
    ];
    const logs = DATES.slice(0, 2).flatMap((d) =>
      twoMeals(d, { protein: 130 }),
    );
    const f = facts({ previous, logs });
    expect(f.lastWeek).toEqual({
      daysActive: 4,
      proteinDaysMet: 3,
      mealsLogged: 8,
    });
    expect(f.best).toEqual({ proteinDaysMet: 6, daysActive: 5 });
    expect(f.trend.map((t) => t.weekStart)).toEqual([
      "2026-09-27",
      "2026-10-04",
      "2026-10-11",
      "2026-10-18",
      "2026-10-25",
    ]);
  });

  it("no previous reports: lastWeek and best are null", () => {
    const f = facts();
    expect(f.lastWeek).toBeNull();
    expect(f.best).toBeNull();
    expect(f.trend).toEqual([]);
  });
});

describe("buildWeeklyFacts — quiet weeks and shape", () => {
  it("zero logs is quiet with seven empty days and still parses", () => {
    const f = facts();
    expect(f.quiet).toBe(true);
    expect(f.daysActive).toBe(0);
    expect(f.days.map((d) => d.date)).toEqual(DATES);
    expect(f.days.every((d) => d.meals === 0 && d.protein === null)).toBe(true);
    expect(weeklyFactsSchema.safeParse(f).success).toBe(true);
  });

  it("buckets by the user's civil day, not UTC", () => {
    // 2026-11-02T05:00Z is Nov 1 21:00 in Los Angeles.
    const f = buildWeeklyFacts(
      inputs({ logs: [log("2026-11-02", 5, { protein: 20 })] }),
      WEEK,
      "America/Los_Angeles",
      false,
    );
    expect(f.days[0].meals).toBe(1);
    expect(f.days[1].meals).toBe(0);
  });

  it("carries the safety signal and tip ids through", () => {
    const f = facts({ tipIds: ["photo", "import"] }, true);
    expect(f.safetySignal).toBe(true);
    expect(f.tipIds).toEqual(["photo", "import"]);
  });
});

describe("buildWeeklyFacts — patterns", () => {
  it("names days with no lunch logged and late dinners, without banned words", () => {
    const logs = DATES.slice(0, 4).flatMap((d, i) => [
      log(d, 8, { mealType: "breakfast", protein: 30 }),
      ...(i < 2 ? [] : [log(d, 13, { mealType: "lunch", protein: 30 })]),
      log(d, 21, { mealType: "dinner", protein: 30 }),
    ]);
    const f = facts({ logs });
    expect(f.patterns).toContain("no lunch logged on 2 days");
    expect(f.patterns).toContain("dinner logged after 9 pm 4 times");
    expect(f.patterns.length).toBeLessThanOrEqual(3);
    for (const p of f.patterns) expect(p).not.toMatch(BANNED);
  });

  it("untagged meals produce no lunch pattern", () => {
    const logs = DATES.slice(0, 4).flatMap((d) => twoMeals(d, { protein: 60 }));
    expect(facts({ logs }).patterns.some((p) => p.includes("lunch"))).toBe(
      false,
    );
  });
});
