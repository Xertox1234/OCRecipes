---
title: "Personalization Phase 2.5 — eval coverage for dismissals, time-of-day, macro-gap signals"
status: in-progress
priority: medium
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [personalization, evals, deferred]
---

# Personalization Phase 2.5 — eval coverage for dismissals, time-of-day, macro-gap signals

## Summary

Phase 2 shipped three personalization signals (2A time-of-day carousel, 2B dismissed-recipe exclusion, 2C macro-gap emphasis), but the meal-suggestion eval dataset has no test cases exercising these signals. A regression in any of them would not be caught by the eval suite.

## Background

Identified during Phase 2 planning (2026-05-09). The eval dataset at `evals/datasets/meal-suggestion-cases.json` has zero personalization-signal cases. `MealSuggestionCaseInput` (in `evals/lib/dataset-schemas.ts:67-115`) accepts `mealType`, `userProfile`, `dailyTargets`, `existingMeals`, `remainingBudget` — no fields for dismissed recipes, time-of-day, or macro-gap. The eval runner at `evals/runner-meal-suggestions.ts:90-95` scores on `macro_accuracy`, `dietary_compliance`, `variety`, `helpfulness` — no `personalization` dimension.

## Acceptance Criteria

- [ ] `evals/lib/dataset-schemas.ts` — extend `MealSuggestionCaseInput` with optional fields:
  - `dismissedTitles?: string[]` — list of previously dismissed recipe titles
  - `macroGapSignal?: { macro: "protein"|"carbs"|"fat"|"calories"; shortAmount: number }` — expected gap emphasis context
- [ ] `evals/runner-meal-suggestions.ts` — thread the new fields through `generateResponse` (lines 106-139) so the service receives `dismissedRecipeTitles` and correct `remainingBudget` for gap emphasis
- [ ] Add a `personalization` rubric dimension to the eval suite (or use `mustNotContain`/`mustContain` assertions):
  - Dismissed titles must NOT appear in any of the 3 suggestion titles
  - Macro-gap signal must be reflected in at least 2 of 3 suggestion macros
- [ ] Add 3-5 new eval cases to `evals/datasets/meal-suggestion-cases.json`:
  - Dismissed recipe exclusion: user with 2 dismissed titles → suggestions must not repeat them
  - Protein gap: user 70% short on protein → suggestions prioritize protein-dense options
  - Carbs gap: user 70% short on carbs → suggestions prioritize carb-dense options
  - Combined: dismissed titles + macro gap active simultaneously
- [ ] Run `npm run eval:meal-suggestions` to establish baseline scores for the new cases
- [ ] Per `docs/patterns/testing.md:1359-1363`: if adding a new `personalization` dimension to `SuiteConfig.dimensions`, update both `SuiteConfig.dimensions` AND the suite's `scoreDimensions` Zod enum

## Implementation Notes

- `evals/runner-meal-suggestions.ts` is backwards-compatible — optional new fields default to `undefined` → empty in service input. Existing cases keep passing without modification.
- The meal-suggestion eval runner (not the coach runner) is the right place for this work.
- For the `mustNotContain` assertion pattern, see how the coach eval uses it for safety violations.
- Dismissed titles for eval should be real recipe titles that exist in `community_recipes` in the test DB (or use mocked titles and check the prompt-level signal rather than suggestion output).

## Dependencies

- Phase 2B (PR #100) merged first — `dismissedRecipeTitles` field on `MealSuggestionInput` required
- Phase 2C (PR #101) merged first — `MacroTargets` type on `MealSuggestionInput` required

## Risks

- Eval cases that check suggestion OUTPUT (not just prompt) are flaky if the LLM is non-deterministic — use `mustNotContain` on dismissed titles (binary, easy to assert) rather than fuzzy macro matching
- Bootstrapped 95% CI requires `EVAL_SAMPLES_PER_CASE > 1` for reliable scores on new cases
