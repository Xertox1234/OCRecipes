import { containsUnsafeCoachAdvice } from "../../lib/ai-safety";
import { matchesDisorderedEating } from "../coach-intent-classifier";
import { civilWeekday } from "./week-window";
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

/**
 * Words no written field may contain (whole word, any case). The writer's
 * prompt lists these same words (writer.ts), so the two cannot drift
 * (audit 2026-11-24, L135).
 */
export const BANNED_WORDS = [
  "missed",
  "failed",
  "only",
  "broken",
  "behind",
  "skipped",
  "didn't eat",
  "deficit",
  "weight",
  "lose",
  "streak",
] as const;
// A straight apostrophe in the list also matches a curly one in the text.
const BANNED_RE = new RegExp(
  `\\b(${BANNED_WORDS.map((w) => w.replace(/'/g, "['’]")).join("|")})\\b`,
  "i",
);
const LAST_WEEK_RE = /\blast week\b/i;
const BEST_RE = /\b(best|record)\b/i;
const CALORIE_RE = /\b(calorie|calories|kcal|cals?)\b/i;
/** "1,950" or "1950" or "12.5". */
const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
/** "5 days", "5 of 7 days", "1 day": captures the count. */
const DAY_COUNT_RE = /\b(\d+)\s+(?:of\s+7\s+)?days?\b/gi;
/** A count written as a word ("five days"); the prompt asks for digits. */
const NUMBER_WORD_RE =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|meals?|times|recipes?|weeks?)\b/i;
const WEEKDAY_RE =
  /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

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
  }
  add(facts.daysActive);
  add(facts.mealsLogged);
  add(facts.recipesAdded);
  add(facts.proteinDaysMet);
  add(facts.caloriesDaysMet);
  add(facts.carbsDaysMet);
  for (const r of facts.recipes) {
    add(r.timesLogged);
    addNumbersFromText(s, r.title); // "13-Bean Soup" may be named as is
  }
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

/**
 * True when this week equals the best on a measure above zero. facts.best
 * spans this week and up to six before it, so it exists from the second
 * report on even when this week is below it (coach audit 2026-11-24, L66).
 */
export function isBestWeek(facts: WeeklyFacts): boolean {
  const best = facts.best;
  if (!best) return false;
  if (facts.daysActive > 0 && facts.daysActive >= best.daysActive) return true;
  return (
    facts.proteinDaysMet !== null &&
    best.proteinDaysMet !== null &&
    facts.proteinDaysMet > 0 &&
    facts.proteinDaysMet >= best.proteinDaysMet
  );
}

/**
 * Counts of days the text may state ("5 days"): the week's day counts and the
 * comparisons built from them, never meals, grams or recipe counts. A count
 * can still be attached to the wrong day measure (daysActive for protein);
 * this narrows the pool, it does not bind each claim (L25).
 */
function dayCounts(facts: WeeklyFacts): Set<number> {
  const s = new Set<number>([7]);
  const add = (v: number | null | undefined) => {
    if (v !== null && v !== undefined) s.add(v);
  };
  add(facts.daysActive);
  add(facts.proteinDaysMet);
  add(facts.caloriesDaysMet);
  add(facts.carbsDaysMet);
  if (facts.lastWeek) {
    add(facts.lastWeek.daysActive);
    add(facts.lastWeek.proteinDaysMet);
    add(Math.abs(facts.daysActive - facts.lastWeek.daysActive));
    if (
      facts.proteinDaysMet !== null &&
      facts.lastWeek.proteinDaysMet !== null
    ) {
      add(Math.abs(facts.proteinDaysMet - facts.lastWeek.proteinDaysMet));
    }
  }
  if (facts.best) {
    add(facts.best.daysActive);
    add(facts.best.proteinDaysMet);
  }
  for (const t of facts.trend) {
    add(t.daysActive);
    add(t.proteinDaysMet);
  }
  for (const p of facts.patterns) addNumbersFromText(s, p);
  return s;
}

/** Weekdays (lower case) of the week's days with a meal logged. */
function loggedWeekdays(facts: WeeklyFacts): Set<string> {
  return new Set(
    facts.days
      .filter((d) => d.meals > 0)
      .map((d) => WEEKDAYS[civilWeekday(d.date)]),
  );
}

/**
 * The text with the user's own recipe titles blanked out, for the word and
 * digit checks: "The Best Banana Bread" or "30-Minute Chili" named as is is
 * not Coach saying "best" or giving a count (coach audit 2026-11-24, L80).
 * Only titles of two or more words count, so a title such as "Best" cannot
 * switch a check off everywhere. Plain string matching: a title is user text
 * and never becomes a pattern. The unsafe-advice check never uses this.
 */
function withoutTitles(text: string, facts: WeeklyFacts): string {
  let out = text.toLowerCase();
  for (const r of facts.recipes) {
    const title = r.title.trim().toLowerCase();
    if (!/\s/.test(title)) continue;
    out = out.split(title).join(" ");
  }
  return out;
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
  const days = dayCounts(facts);
  const weekdays = loggedWeekdays(facts);
  const next = parsed.data.next;
  for (const t of texts(parsed.data)) {
    const own = withoutTitles(t, facts);
    if (BANNED_RE.test(own)) return { ok: false, reason: "banned-word" };
    for (const m of t.match(NUMBER_RE) ?? []) {
      if (!allowed.has(Number(m.replace(/,/g, "")))) {
        return { ok: false, reason: "unbacked-number" };
      }
    }
    for (const m of own.matchAll(DAY_COUNT_RE)) {
      if (!days.has(Number(m[1]))) {
        return { ok: false, reason: "unbacked-day-count" };
      }
    }
    if (NUMBER_WORD_RE.test(own)) return { ok: false, reason: "number-word" };
    // The next-week idea is about next week, so any weekday may be named.
    if (!next || t !== next.text) {
      for (const m of own.matchAll(WEEKDAY_RE)) {
        if (!weekdays.has(m[1].toLowerCase())) {
          return { ok: false, reason: "unlogged-weekday" };
        }
      }
    }
    if (LAST_WEEK_RE.test(own) && !facts.lastWeek) {
      return { ok: false, reason: "no-last-week" };
    }
    if (BEST_RE.test(own) && !isBestWeek(facts)) {
      return { ok: false, reason: "no-best" };
    }
    if (containsUnsafeCoachAdvice(t)) return { ok: false, reason: "unsafe" };
  }
  // The idea for next week carries no numbers of Coach's own (no grams, times
  // or counts); digits inside a named recipe title are the user's.
  if (next && /\d/.test(withoutTitles(next.text, facts)))
    return { ok: false, reason: "number-in-next" };
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

/** The safety-week pointer to help, in the coach's referral voice. */
export const SAFETY_REFERRAL =
  "If food has felt hard lately, a doctor or registered dietitian can help, and Coach is here whenever you want to talk.";

/** Text built from the facts alone: always valid, costs nothing. */
export function templateContent(facts: WeeklyFacts): WeeklyReportContent {
  if (facts.safetySignal) {
    return {
      headline: templateHeadline(facts),
      wins: [],
      watch: [],
      next: null,
      fromLogged: SAFETY_REFERRAL,
      trendLine: null,
    };
  }
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
