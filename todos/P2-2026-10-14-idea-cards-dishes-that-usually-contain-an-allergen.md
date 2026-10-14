---
title: "Idea cards can suggest dishes that usually contain the user's allergen (Pad Thai for peanuts, fritters for eggs)"
status: backlog
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

- [ ] Decide the fix:
  - (a) A prompt rule: don't suggest dishes whose classic version relies on a listed allergen unless the card says how it avoids it, e.g. "egg-free fritters bound with chickpea flour".
  - (b) Show "made without <allergen>" on the card.
  - (c) Accept it, because the make step already protects.
- [ ] Add an eval case or check that catches a classic-allergen dish (peanut → Pad Thai/satay; egg → fritters/pancakes/carbonara) for a severe allergy.
- [ ] Re-run `npm run eval:inspired` and compare allergen_safety with the 2026-10-14 runs (8.8 and 8.3; the low cases were fritters and Pad Thai).

## Implementation Notes

- `server/services/inspired-recipes/suggest-listing.ts`: system prompt and `dropAllergenConflicts`
- `evals/datasets/inspired-suggestions-cases.json`, `evals/lib/inspired-checks.ts`
- Note: the existing "no X-free naming" rule was added because "gluten-free pasta" for a wheat allergy got dropped by the net. Option (a) must not undo that; a phrase like "egg-free" would trip it.
