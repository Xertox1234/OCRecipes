import { containsUnsafeCoachAdvice } from "../../lib/ai-safety";
import { matchesDisorderedEating } from "../coach-intent-classifier";
import {
  weeklyReportContentSchema,
  type WeeklyFacts,
  type WeeklyReportContent,
} from "@shared/schemas/coach-weekly-report";

/**
 * Guards for the weekly report's written text (spec §"Safety rules"). Coach
 * writes sentences; this module decides whether they may be stored. Anything
 * that fails is replaced by templateContent, which costs nothing.
 */

/** Words no written field may contain (whole word, any case). */
const BANNED_RE =
  /\b(missed|failed|only|broken|behind|skipped|didn['’]t eat|deficit|weight|lose|streak)\b/i;
const LAST_WEEK_RE = /\blast week\b/i;
const BEST_RE = /\b(best|record)\b/i;
const CALORIE_RE = /\b(calorie|calories|kcal|cals?)\b/i;
/** "1,950" or "1950" or "12.5". */
const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

export function hasSafetySignal(messages: string[]): boolean {
  return messages.some(matchesDisorderedEating);
}

function addNumbersFromText(set: Set<number>, text: string) {
  for (const m of text.match(NUMBER_RE) ?? [])
    set.add(Number(m.replace(/,/g, "")));
}

/** Every number the written text may use. */
export function factNumbers(facts: WeeklyFacts): Set<number> {
  const s = new Set<number>([7]);
  const add = (v: number | null | undefined) => {
    if (v !== null && v !== undefined) s.add(Math.round(v));
  };
  add(facts.goals.calories);
  add(facts.goals.protein);
  add(facts.goals.carbs);
  for (const d of facts.days) {
    add(d.meals);
    add(d.calories);
    add(d.protein);
    add(d.carbs);
    add(Number(d.date.slice(8, 10)));
  }
  add(facts.daysActive);
  add(facts.mealsLogged);
  add(facts.recipesAdded);
  add(facts.proteinDaysMet);
  add(facts.caloriesDaysMet);
  add(facts.carbsDaysMet);
  for (const r of facts.recipes) add(r.timesLogged);
  for (const p of facts.patterns) addNumbersFromText(s, p);
  if (facts.lastWeek) {
    const lw = facts.lastWeek;
    add(lw.daysActive);
    add(lw.proteinDaysMet);
    add(lw.mealsLogged);
    add(Math.abs(facts.daysActive - lw.daysActive));
    add(Math.abs(facts.mealsLogged - lw.mealsLogged));
    if (facts.proteinDaysMet !== null && lw.proteinDaysMet !== null) {
      add(Math.abs(facts.proteinDaysMet - lw.proteinDaysMet));
    }
  }
  if (facts.best) {
    add(facts.best.daysActive);
    add(facts.best.proteinDaysMet);
  }
  for (const t of facts.trend) {
    add(t.daysActive);
    add(t.proteinDaysMet);
    add(t.recipesAdded);
  }
  return s;
}

function texts(c: WeeklyReportContent): string[] {
  return [
    c.headline,
    ...c.wins,
    ...c.watch,
    ...(c.next ? [c.next.text] : []),
    ...(c.fromLogged ? [c.fromLogged] : []),
    ...(c.trendLine ? [c.trendLine] : []),
  ];
}

export function validateContent(
  content: WeeklyReportContent,
  facts: WeeklyFacts,
): { ok: true } | { ok: false; reason: string } {
  const parsed = weeklyReportContentSchema.safeParse(content);
  if (!parsed.success) return { ok: false, reason: "schema" };
  const allowed = factNumbers(facts);
  for (const t of texts(parsed.data)) {
    if (BANNED_RE.test(t)) return { ok: false, reason: "banned-word" };
    for (const m of t.match(NUMBER_RE) ?? []) {
      if (!allowed.has(Number(m.replace(/,/g, "")))) {
        return { ok: false, reason: "unbacked-number" };
      }
    }
    if (LAST_WEEK_RE.test(t) && !facts.lastWeek) {
      return { ok: false, reason: "no-last-week" };
    }
    if (BEST_RE.test(t) && !facts.best) return { ok: false, reason: "no-best" };
    if (containsUnsafeCoachAdvice(t)) return { ok: false, reason: "unsafe" };
  }
  const next = parsed.data.next;
  if (next?.recipeId != null) {
    const found = facts.recipes.some(
      (r) => r.recipeId === next.recipeId && r.recipeType === next.recipeType,
    );
    if (!found) return { ok: false, reason: "unknown-recipe" };
  }
  return { ok: true };
}

function templateHeadline(facts: WeeklyFacts): string {
  if (facts.safetySignal) return "Here's your week. Be kind to yourself.";
  if (facts.quiet) return "A lighter week for logging, and that's fine.";
  if (facts.proteinDaysMet !== null && facts.proteinDaysMet >= 5) {
    return `Protein on target ${facts.proteinDaysMet} of 7 days.`;
  }
  return `You showed up ${facts.daysActive} of 7 days this week.`;
}

/** Text built from the facts alone: always valid, costs nothing. */
export function templateContent(facts: WeeklyFacts): WeeklyReportContent {
  const wins: string[] = [];
  if (facts.daysActive > 0) {
    wins.push(
      facts.daysActive === 1
        ? `You logged ${facts.mealsLogged} ${facts.mealsLogged === 1 ? "meal" : "meals"} this week.`
        : `You logged ${facts.mealsLogged} meals across ${facts.daysActive} days.`,
    );
  }
  if (facts.recipesAdded > 0) {
    wins.push(
      facts.recipesAdded === 1
        ? "You added a new recipe to your kitchen."
        : `You added ${facts.recipesAdded} new recipes to your kitchen.`,
    );
  }
  return {
    headline: templateHeadline(facts),
    wins,
    watch: [],
    next: null,
    fromLogged: null,
    trendLine: null,
  };
}

function mentionsCalories(text: string, facts: WeeklyFacts): boolean {
  if (CALORIE_RE.test(text)) return true;
  const calorieNumbers = new Set<number>(
    [facts.goals.calories, ...facts.days.map((d) => d.calories)]
      .filter((v): v is number => v !== null)
      .map(Math.round),
  );
  return (text.match(NUMBER_RE) ?? []).some((m) =>
    calorieNumbers.has(Number(m.replace(/,/g, ""))),
  );
}

/**
 * Remove what the facts say must not be shown: after a safety signal, no
 * Watch, Next or trend line; under the low-calorie guard, no calorie mention.
 */
export function applyGuards(
  content: WeeklyReportContent,
  facts: WeeklyFacts,
): WeeklyReportContent {
  let c = { ...content, wins: [...content.wins], watch: [...content.watch] };
  if (facts.safetySignal) {
    c = { ...c, watch: [], next: null, trendLine: null };
  }
  if (facts.lowCalorieGuard) {
    const clean = (t: string | null) =>
      t !== null && mentionsCalories(t, facts) ? null : t;
    c = {
      headline: mentionsCalories(c.headline, facts)
        ? templateHeadline(facts)
        : c.headline,
      wins: c.wins.filter((t) => !mentionsCalories(t, facts)),
      watch: c.watch.filter((t) => !mentionsCalories(t, facts)),
      next: c.next && mentionsCalories(c.next.text, facts) ? null : c.next,
      fromLogged: clean(c.fromLogged),
      trendLine: clean(c.trendLine),
    };
  }
  return c;
}
