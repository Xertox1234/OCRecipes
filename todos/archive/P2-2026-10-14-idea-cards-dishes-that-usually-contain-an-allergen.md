---
title: "Idea cards can suggest dishes that usually contain the user's allergen (Pad Thai for peanuts, fritters for eggs)"
status: done
priority: medium
created: 2026-10-14
updated: 2026-10-14
assignee:
labels: [deferred, ai]
github_issue:
---

# Idea cards can suggest dishes that usually contain the user's allergen

## Summary

The inspired-suggestions eval judge keeps flagging idea cards for dishes that are _usually_ made with one of the user's listed allergens, even though the card text never names it. Examples: "Zucchini Noodle Pad Thai" for a severe peanut allergy, and "Zucchini Fritters" or "Banana Oatmeal Pancakes" for a severe egg allergy.

## Background

Found while re-running `npm run eval:inspired` for the text-only cards change (2026-10-14). The Task 14 run (2026-10-12) flagged the same fritters card for eggs, so the gap predates that change. Across three runs it showed up once or twice per run.

Why it isn't worse:

- `dropAllergenConflicts` (`server/services/inspired-recipes/suggest-listing.ts`) only catches allergens the card _names_.
- The card is an idea, not a recipe. "Make this mine" passes the user's profile, allergies included, to `generateFullRecipe` (`server/routes/inspired-recipes.ts`), so the real recipe is written to avoid the allergen.

The risk is a user cooking the dish from memory. A traditionally-peanut dish shown to a severe-peanut user also undermines trust.

## Acceptance Criteria

- [x] Decide the fix (chose (a)):
  - (a) A prompt rule: don't suggest dishes whose classic version relies on a listed allergen unless the card says how it avoids it, e.g. "egg-free fritters bound with chickpea flour".
  - (b) Show "made without <allergen>" on the card.
  - (c) Accept it, because the make step already protects.
- [x] Add an eval case or check that catches a classic-allergen dish (peanut → Pad Thai/satay; egg → fritters/pancakes/carbonara) for a severe allergy.
- [x] Re-run `npm run eval:inspired` and compare allergen_safety with the 2026-10-14 runs (8.8 and 8.3; the low cases were fritters and Pad Thai).

## Implementation Notes

- `server/services/inspired-recipes/suggest-listing.ts`: system prompt and `dropAllergenConflicts`
- `evals/datasets/inspired-suggestions-cases.json`, `evals/lib/inspired-checks.ts`
- Note: the existing "no X-free naming" rule was added because "gluten-free pasta" for a wheat allergy got dropped by the net. Option (a) must not undo that; a phrase like "egg-free" would trip it.

## Updates

### 2026-10-16

- Chose (a): one system-prompt rule in `suggest-listing.ts` skipping dishes whose classic version relies on a listed allergen (Pad Thai/satay for peanut; fritters/pancakes/carbonara/custard for egg), phrased as "pick a naturally free dish, not a substituted version" so it stays consistent with the no-"X-free"-naming rule.
- Added eval cases `insp-peanut-classic-01` and `insp-egg-classic-01` whose `mustAvoid` includes the classic dish names.
- Re-ran `npm run eval:inspired` (14 cases) with and without the rule: allergen_safety 8.4 in both runs (2026-10-14 runs: 8.8, 8.3), overall 8.2 both, n=1 each - the rule did not move the aggregate. Neither run put a literal Pad Thai, satay, fritter, pancake or carbonara card on the new cases, so at n=1 the new cases do not discriminate with/without the rule; they are a deterministic guard against regression, not proof the rule changes behaviour. The without-rule `insp-egg-soy-01` run did return "Zucchini and Corn Fritters" (existing case, no "fritter" in its mustAvoid); the judge marked it ambiguous.
- `insp-gluten-celiac-01` returns null (all cards dropped) both with and without the rule - pre-existing, unrelated.
