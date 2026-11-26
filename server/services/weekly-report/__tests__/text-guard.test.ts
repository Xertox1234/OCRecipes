import { describe, it, expect } from "vitest";
import {
  applyGuards,
  factNumbers,
  isBestWeek,
  hasSafetySignal,
  templateContent,
  validateContent,
} from "../text-guard";
import { buildWeeklyFacts, type WeeklyInputs } from "../facts";
import { createMockWeeklyFacts } from "../../../__tests__/factories";
import type {
  WeeklyFacts,
  WeeklyReportContent,
} from "@shared/schemas/coach-weekly-report";

const WEEK = { weekStart: "2026-11-01", weekEnd: "2026-11-07" };
const DATES = [1, 2, 3, 4, 5, 6, 7].map((d) => `2026-11-0${d}`);

function meals(date: string, protein: number, calories: number) {
  return [8, 18].map((h) => ({
    loggedAt: new Date(`${date}T${String(h).padStart(2, "0")}:00:00Z`),
    mealType: null,
    calories: calories / 2,
    protein: protein / 2,
    carbs: null,
  }));
}

function build(over: Partial<WeeklyInputs> = {}, safety = false): WeeklyFacts {
  return buildWeeklyFacts(
    {
      goals: { calories: 2000, protein: 120, carbs: null },
      logs: [],
      recipes: [],
      previous: [],
      coachMessages: [],
      tipIds: [],
      ...over,
    },
    WEEK,
    "UTC",
    safety,
  );
}

const normal = build({
  logs: DATES.slice(0, 5).flatMap((d) => meals(d, 110, 1950)),
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
});
const quiet = build({ logs: meals(DATES[0], 60, 900) });
const zero = build();
const safety = build(
  { logs: DATES.slice(0, 4).flatMap((d) => meals(d, 90, 1500)) },
  true,
);
const lowCal = build({
  logs: DATES.slice(0, 5).flatMap((d) => meals(d, 110, 1200)),
});

const base: WeeklyReportContent = {
  headline: "You showed up 5 of 7 days this week.",
  wins: ["Protein on target 5 of 7 days."],
  watch: [],
  next: null,
  fromLogged: null,
  trendLine: null,
};

describe("validateContent", () => {
  it("accepts text whose numbers all come from the facts", () => {
    expect(validateContent(base, normal)).toEqual({ ok: true });
  });

  it("rejects a banned word (skipped)", () => {
    const r = validateContent(
      { ...base, watch: ["You skipped lunch twice."] },
      normal,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects 'didn’t eat' with a curly apostrophe", () => {
    const r = validateContent(
      { ...base, watch: ["You didn’t eat breakfast."] },
      normal,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a number that is not in the facts", () => {
    const r = validateContent(
      { ...base, headline: "You hit 9 days this week." },
      normal,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects 'best week yet' when there is nothing to compare with", () => {
    expect(normal.best).toBeNull();
    const r = validateContent(
      { ...base, headline: "Your best week yet." },
      normal,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects 'last week' phrasing without last week's facts", () => {
    const r = validateContent(
      { ...base, wins: ["More days than last week."] },
      normal,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a next-week recipe that is not one of the user's", () => {
    const r = validateContent(
      {
        ...base,
        next: { text: "Cook it again.", recipeId: 99, recipeType: "mealPlan" },
      },
      normal,
    );
    expect(r.ok).toBe(false);
    const ok = validateContent(
      {
        ...base,
        next: {
          text: "Cook the lentil stew again.",
          recipeId: 12,
          recipeType: "mealPlan",
        },
      },
      normal,
    );
    expect(ok).toEqual({ ok: true });
  });

  it("rejects content that fails the schema", () => {
    const r = validateContent(
      { ...base, wins: ["a", "b", "c"] } as WeeklyReportContent,
      normal,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a day of the month quoted as a count (dates are not facts to quote)", () => {
    // 6 appears in this week only as Nov 6's day of the month.
    expect(factNumbers(normal).has(6)).toBe(false);
    const r = validateContent(
      { ...base, wins: ["Protein on target 6 days."] },
      normal,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects any digit in the next-week idea", () => {
    const r = validateContent(
      {
        ...base,
        next: {
          text: "Aim for 2 servings of beans.",
          recipeId: null,
          recipeType: null,
        },
      },
      normal,
    );
    expect(r.ok).toBe(false);
  });

  it("accepts thousands separators that match a fact", () => {
    expect(factNumbers(normal).has(1950)).toBe(true);
    const r = validateContent(
      { ...base, wins: ["Most days landed near 1,950 kcal."] },
      normal,
    );
    expect(r).toEqual({ ok: true });
  });
});

describe("factNumbers — recipe titles", () => {
  it("allows the digits in a recipe title the user added", () => {
    const f = build({
      recipes: [
        {
          recipeId: 3,
          recipeType: "mealPlan",
          title: "13-Bean Soup",
          how: "imported",
          timesLogged: 0,
          imageUrl: null,
        },
      ],
    });
    expect(factNumbers(f).has(13)).toBe(true);
  });
});

// Audit 2026-11-24 L80: a recipe title is the user's own text, so naming it
// must not trip the word and digit checks meant for Coach's own sentences.
describe("validateContent — naming a recipe title", () => {
  const withRecipe = (title: string, recipeId = 7) =>
    build({
      logs: DATES.slice(0, 5).flatMap((d) => meals(d, 110, 1950)),
      recipes: [
        {
          recipeId,
          recipeType: "mealPlan",
          title,
          how: "saved",
          timesLogged: 1,
          imageUrl: null,
        },
      ],
    });
  const nextNaming = (text: string, recipeId = 7) => ({
    ...base,
    next: { text, recipeId, recipeType: "mealPlan" as const },
  });

  it("accepts a title with digits in the next-week idea", () => {
    const f = withRecipe("30-Minute Chili");
    expect(
      validateContent(nextNaming("Try the 30-Minute Chili again."), f),
    ).toEqual({ ok: true });
  });

  it("accepts a title with a banned or 'best' word, in any case", () => {
    const f = withRecipe("The Best Banana Bread");
    expect(f.best).toBeNull();
    expect(
      validateContent(nextNaming("Bake the best banana bread again."), f),
    ).toEqual({ ok: true });
    const g = withRecipe("Only Onion Soup");
    expect(
      validateContent(
        { ...base, wins: ["You saved Only Onion Soup this week."] },
        g,
      ),
    ).toEqual({ ok: true });
  });

  it("still rejects the same words and digits outside the title (control)", () => {
    const f = withRecipe("30-Minute Chili");
    expect(
      validateContent(nextNaming("Cook the 30-Minute Chili 2 times."), f).ok,
    ).toBe(false);
    const g = withRecipe("The Best Banana Bread");
    expect(
      validateContent(
        { ...base, headline: "Your best week, with The Best Banana Bread." },
        g,
      ).ok,
    ).toBe(false);
  });

  it("a one-word title is never exempted, so a title cannot switch a check off", () => {
    const f = withRecipe("Best");
    expect(
      validateContent({ ...base, headline: "Your Best week yet." }, f).ok,
    ).toBe(false);
  });

  it("a title never exempts unsafe advice", () => {
    // No banned word here: only the unsafe-advice check can catch it.
    const f = withRecipe("Water Only Fast Broth");
    const r = validateContent(
      { ...base, wins: ["You saved Water Only Fast Broth this week."] },
      f,
    );
    expect(r).toEqual({ ok: false, reason: "unsafe" });
  });
});

describe("templateContent", () => {
  it.each([
    ["normal", normal],
    ["quiet", quiet],
    ["zero", zero],
    ["safety", safety],
    ["low calorie", lowCal],
  ])("passes its own validation for a %s week", (_name, facts) => {
    expect(validateContent(templateContent(facts), facts)).toEqual({
      ok: true,
    });
  });

  it("uses the spec's headlines", () => {
    expect(templateContent(normal).headline).toBe(
      "Protein on target 5 of 7 days.",
    );
    expect(templateContent(quiet).headline).toBe(
      "A lighter week for logging, and that's fine.",
    );
    expect(templateContent(zero).headline).toBe(
      "A lighter week for logging, and that's fine.",
    );
    expect(templateContent(safety).headline).toBe(
      "Here's your week. Be kind to yourself.",
    );
    const four = build({
      logs: DATES.slice(0, 4).flatMap((d) => meals(d, 50, 1950)),
    });
    expect(templateContent(four).headline).toBe(
      "You showed up 4 of 7 days this week.",
    );
  });

  it("a safety week gets no wins and a gentle pointer to professional help", () => {
    const t = templateContent(safety);
    expect(t.wins).toEqual([]);
    expect(t.fromLogged).toMatch(/doctor or registered dietitian/);
    expect(validateContent(t, safety)).toEqual({ ok: true });
  });

  it("writes no watch, next or trend line, and no wins for an empty week", () => {
    const t = templateContent(zero);
    expect(t.wins).toEqual([]);
    expect(t.watch).toEqual([]);
    expect(t.next).toBeNull();
    expect(t.trendLine).toBeNull();
  });
});

describe("applyGuards", () => {
  const full: WeeklyReportContent = {
    headline: "A steady week.",
    wins: ["You logged 8 meals.", "Calories landed close to 2000 most days."],
    watch: ["Dinner came late on 2 days."],
    next: { text: "Try an earlier dinner.", recipeId: null, recipeType: null },
    fromLogged: null,
    trendLine: "Protein days have climbed.",
  };

  it("a safety signal drops watch, next and the trend line", () => {
    const g = applyGuards(full, safety);
    expect(g.watch).toEqual([]);
    expect(g.next).toBeNull();
    expect(g.trendLine).toBeNull();
    expect(g.headline).toBe(full.headline);
  });

  it("the low-calorie guard drops every calorie mention", () => {
    expect(lowCal.lowCalorieGuard).toBe(true);
    const g = applyGuards(full, lowCal);
    expect(g.wins).toEqual(["You logged 8 meals."]);
    expect(JSON.stringify(g)).not.toMatch(/calori|kcal/i);
  });

  it("a calorie headline under the guard falls back to the template headline", () => {
    const g = applyGuards(
      { ...full, headline: "Calories were steady." },
      lowCal,
    );
    expect(g.headline).toBe(templateContent(lowCal).headline);
  });

  it("leaves content alone when no guard applies", () => {
    expect(applyGuards(full, normal)).toEqual(full);
  });
});

describe("hasSafetySignal", () => {
  it("flags a disordered-eating message and ignores purée", () => {
    expect(hasSafetySignal(["what's for dinner", "I want to purge"])).toBe(
      true,
    );
    expect(hasSafetySignal(["I made purée tonight"])).toBe(false);
    expect(hasSafetySignal([])).toBe(false);
  });
});

// Audit 2026-11-24 L66: "best"/"record" passed whenever any previous week
// existed, even when this week was below the best.
describe("validateContent — best week", () => {
  const prev = (daysActive: number, proteinDaysMet: number) => ({
    weekStart: "2026-10-25",
    weekEnd: "2026-10-31",
    daysActive,
    proteinDaysMet,
    mealsLogged: daysActive * 2,
    recipesAdded: 0,
    tipIds: [],
  });
  const withPrev = (p: ReturnType<typeof prev>) =>
    build({
      logs: DATES.slice(0, 5).flatMap((d) => meals(d, 110, 1950)),
      previous: [createMockWeeklyFacts(p)],
    });

  it("rejects 'best' when this week is below the best week", () => {
    const f = withPrev(prev(7, 7));
    expect(f.best).not.toBeNull();
    expect(isBestWeek(f)).toBe(false);
    expect(
      validateContent({ ...base, headline: "Your best week yet." }, f),
    ).toEqual({ ok: false, reason: "no-best" });
  });

  it("accepts 'best' when this week ties or beats the best (control)", () => {
    const f = withPrev(prev(3, 2));
    expect(isBestWeek(f)).toBe(true);
    expect(
      validateContent({ ...base, headline: "Your best week yet." }, f),
    ).toEqual({ ok: true });
  });

  it("a tie at zero is not a best week", () => {
    const f = build({ previous: [createMockWeeklyFacts(prev(0, 0))] });
    expect(f.daysActive).toBe(0);
    expect(isBestWeek(f)).toBe(false);
  });
});

// Audit 2026-11-24 L25: numbers were checked against one pool, so a real
// number could be attached to the wrong claim; number words and weekday
// names were never checked.
describe("validateContent — claims about days", () => {
  // normal: 5 days active, protein met on 5 (110 >= 108), logs Nov 1-5.
  it("rejects a day count that is not one of the week's day counts", () => {
    // 10 is mealsLogged, not a count of days.
    expect(factNumbers(normal).has(10)).toBe(true);
    expect(
      validateContent(
        { ...base, wins: ["Protein on target 10 days this week."] },
        normal,
      ),
    ).toEqual({ ok: false, reason: "unbacked-day-count" });
  });

  it("accepts a real day count, with or without 'of 7' (control)", () => {
    expect(
      validateContent(
        { ...base, wins: ["Protein on target 5 of 7 days."] },
        normal,
      ),
    ).toEqual({ ok: true });
    expect(
      validateContent({ ...base, wins: ["You logged on 5 days."] }, normal),
    ).toEqual({ ok: true });
  });

  it("rejects a count written as a word", () => {
    expect(
      validateContent(
        { ...base, wins: ["Protein on target five days this week."] },
        normal,
      ),
    ).toEqual({ ok: false, reason: "number-word" });
  });

  it("rejects a weekday with nothing logged, accepts one with meals", () => {
    // Nov 1 2026 is a Sunday; Nov 6 (Friday) has no meals.
    expect(
      validateContent(
        { ...base, wins: ["Friday was your strongest day."] },
        normal,
      ),
    ).toEqual({ ok: false, reason: "unlogged-weekday" });
    expect(
      validateContent(
        { ...base, wins: ["Tuesday was your strongest day."] },
        normal,
      ),
    ).toEqual({ ok: true });
  });

  it("lets the next-week idea name any weekday (it is about next week)", () => {
    expect(
      validateContent(
        {
          ...base,
          next: {
            text: "Try prepping lunch on Friday.",
            recipeId: null,
            recipeType: null,
          },
        },
        normal,
      ),
    ).toEqual({ ok: true });
  });
});
