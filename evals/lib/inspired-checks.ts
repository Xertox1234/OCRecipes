// Deterministic checks for the inspired-suggestions eval (run before the judge).
import type { SuggestionDraft } from "../../shared/schemas/inspired-recipes";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word, case-insensitive match; trailing punctuation never blocks it. */
export function containsTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  // Lookarounds instead of \b so terms ending in non-word chars still work.
  // A negated mention ("shellfish-free", "no peanuts", "without dairy") is a
  // declaration of safety, not a conflict.
  const e = escapeRegex(t);
  const negated = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:(?:no|without|free of|free from)\\s+${e}|${e}[\\s-]free)(?![\\p{L}\\p{N}])`,
    "giu",
  );
  text = text.replace(negated, " ");
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegex(t)}(?![\\p{L}\\p{N}])`,
    "iu",
  );
  return re.test(text);
}

/** Returns failure messages; an empty array means every check passed. */
export function checkSuggestionCards(
  cards: SuggestionDraft[] | null,
  mustAvoid: string[],
  inspirationTitles: string[],
): string[] {
  if (cards === null) return ["returned null"];
  const failures: string[] = [];
  if (cards.length < 1 || cards.length > 8) {
    failures.push(`expected 1-8 cards, got ${cards.length}`);
  }
  const copied = new Set(inspirationTitles.map((t) => t.trim().toLowerCase()));
  cards.forEach((c, i) => {
    const text = [c.title, c.description, ...c.tags].join(" \n ");
    for (const term of mustAvoid) {
      if (containsTerm(text, term)) {
        failures.push(`card ${i + 1} ("${c.title}") contains "${term}"`);
      }
    }
    if (copied.has(c.title.trim().toLowerCase())) {
      failures.push(`card ${i + 1} copies inspiration title "${c.title}"`);
    }
  });
  return failures;
}
