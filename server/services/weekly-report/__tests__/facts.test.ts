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

// Reliability audit 2026-11-19 L-xc-7: a day whose meals carry no protein
// figure is unknown, not a missed target — the writer (and the model) read
// `false` as "not met".
describe("buildWeeklyFacts — a nutrient no meal recorded", () => {
  it("is unknown (null) for a logged day, while other nutrients still count", () => {
    const f = facts({ logs: twoMeals(DATES[0], { calories: 2000 }) });
    expect(f.days[0].protein).toBeNull();
    expect(f.days[0].proteinMet).toBeNull();
    expect(f.days[0].caloriesMet).toBe(true);
    expect(f.proteinDaysMet).toBe(0);
    expect(weeklyFactsSchema.safeParse(f).success).toBe(true);
  });

  it("stays not met (false) on a day with no meals (control)", () => {
    const f = facts({ logs: twoMeals(DATES[0], { protein: 120 }) });
    expect(f.days[1].meals).toBe(0);
    expect(f.days[1].proteinMet).toBe(false);
  });
});

// Audit 2026-11-24 L23: a day where some meals recorded the nutrient and some
// did not has a total that is too low, so "not met" is not known.
describe("buildWeeklyFacts — a nutrient some meals did not record", () => {
  const partial = (date: string, v: Partial<Log>) => [
    log(date, 8, v),
    log(date, 13, v),
    log(date, 19, {}), // logged, no nutrition recorded
  ];

  it("a short protein total with an unrecorded meal is unknown, not missed", () => {
    const f = facts({ logs: partial(DATES[0], { protein: 35 }) });
    expect(f.days[0].protein).toBe(70);
    expect(f.days[0].proteinMet).toBeNull();
    expect(f.proteinDaysMet).toBe(0);
  });

  it("a protein total already over the goal still counts as met", () => {
    const f = facts({ logs: partial(DATES[0], { protein: 60 }) });
    expect(f.days[0].proteinMet).toBe(true);
    expect(f.proteinDaysMet).toBe(1);
  });

  it("a calorie or carb range verdict is unknown when a meal is unrecorded", () => {
    const f = facts({
      logs: partial(DATES[0], { calories: 1000, carbs: 110 }),
    });
    expect(f.days[0].calories).toBe(2000);
    expect(f.days[0].caloriesMet).toBeNull();
    expect(f.days[0].carbsMet).toBeNull();
  });

  it("every meal recorded keeps the plain verdict (control)", () => {
    const f = facts({ logs: twoMeals(DATES[0], { protein: 70 }) });
    expect(f.days[0].proteinMet).toBe(false);
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

  // Audit 2026-11-24 L22: with no calorie goal the guard used to be off, so a
  // week of 600 kcal days could be celebrated. The 1,200 kcal safety floor
  // stands in for the goal.
  const noCalGoal = { calories: null, protein: 120, carbs: null };

  it("no calorie goal: most full days under 1,200 kcal set the guard", () => {
    const logs = DATES.slice(0, 6).flatMap((d) =>
      twoMeals(d, { calories: 600, protein: 130 }),
    );
    const f = facts({ goals: noCalGoal, logs });
    expect(f.proteinDaysMet).toBe(6);
    expect(f.lowCalorieGuard).toBe(true);
    expect(f.celebrate).toBe(false);
  });

  it("no calorie goal: days at 1,200 kcal or more do not (control)", () => {
    const logs = DATES.slice(0, 6).flatMap((d) =>
      twoMeals(d, { calories: 1200, protein: 130 }),
    );
    const f = facts({ goals: noCalGoal, logs });
    expect(f.lowCalorieGuard).toBe(false);
    expect(f.celebrate).toBe(true);
  });

  it("a goal keeps the spec's 70% rule, not the floor (control)", () => {
    const logs = DATES.slice(0, 6).flatMap((d) =>
      twoMeals(d, { calories: 1100 }),
    );
    expect(
      facts({ goals: { calories: 1500, protein: null, carbs: null }, logs })
        .lowCalorieGuard,
    ).toBe(false);
  });

  it("an understated partial day still counts toward the guard (safe side)", () => {
    const logs = DATES.slice(0, 6).flatMap((d) => [
      log(d, 8, { calories: 500 }),
      log(d, 19, {}),
    ]);
    expect(facts({ logs }).lowCalorieGuard).toBe(true);
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

// Audit 2026-11-24 L69: the recipe list rides the AI prompt, the stored row
// and every report response, so it is capped; the count stays the true one.
describe("buildWeeklyFacts — recipe list cap", () => {
  const recipe = (i: number): WeeklyInputs["recipes"][number] => ({
    recipeId: i,
    recipeType: "mealPlan",
    title: `Recipe ${i}`,
    how: "saved",
    timesLogged: 0,
    imageUrl: null,
  });

  it("keeps the first 12 recipes but counts all of them", () => {
    const recipes = Array.from({ length: 40 }, (_, i) => recipe(i + 1));
    const f = facts({ recipes });
    expect(f.recipes).toHaveLength(12);
    expect(f.recipes[0].recipeId).toBe(1);
    expect(f.recipesAdded).toBe(40);
  });

  it("leaves a short list as it is (control)", () => {
    const f = facts({ recipes: [recipe(1), recipe(2)] });
    expect(f.recipes.map((r) => r.recipeId)).toEqual([1, 2]);
    expect(f.recipesAdded).toBe(2);
  });
});
