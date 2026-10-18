---
title: "Diet conflict keywords: stop clearing real meat, add missing meat words, fix 'prep + cook' time text"
status: in-progress
priority: medium
created: 2026-10-17
updated: 2026-10-17
assignee:
labels: [deferred, bug, nutrition]
github_issue:
---

# Diet conflict keywords: stop clearing real meat, add missing meat words, fix "prep + cook" time text

## Summary

The new Vegetarian/Vegan icons are absence claims. Review of the attribute-icons PR found ingredient names that wrongly pass as meat-free, and a time format that wrongly reads as Quick. Fix the keyword lists and the parser so the icons never claim something false.

## Background

Deferred from the recipe attribute icons PR (one review pass per PR: warnings are fixed in a follow-up, not on the reviewed branch). The baseline code-reviewer measured each case with `deriveRecipeDietConflicts` → `getRecipeAttributes`:

1. **Ambiguous plant qualifiers clear real meat.** `PLANT_QUALIFIERS` holds words that also come before real meat. `"vegetable beef soup"`, `"mushroom beef"`, `"soy chicken"` and `"vegetable chicken soup"` all give `conflicts = []`, so a recipe wrongly tagged vegetarian shows a checked Vegetarian icon. Controls: `"beef"` → `["meat"]`, `"chicken"` → `["poultry"]`.
2. **The qualifier and egg checks look at any match, not each one.** `"chicken egg noodles with chicken"` gives `[]`, because the first "chicken" is followed by "egg".
3. **Missing meat words.** `"ground meat"`, `"meat sauce"`, `"mutton"`, `"rabbit"` and `"lardons"` all give `[]`.
4. **"Prep 10 min, cook 25 min" reads as 25.** `parseTimeEstimateMinutes` takes the last minutes figure, which is right for a range ("20-30 min") but wrong for listed parts. The recipe-generation prompt asks for prep + cook in `timeEstimate`, so this format can occur, and a 35-minute recipe shows Quick.

Suppression is the dangerous direction for an absence claim: when in doubt, flag.

## Acceptance Criteria

- [ ] `PLANT_QUALIFIERS` keeps only words that unambiguously name a substitute (vegan, vegetarian, veggie, plant-based, meatless, meat-free, seitan, jackfruit, microbial). Mushroom, soy, tofu and vegetable are removed, unless a narrower rule is designed and tested.
- [ ] The qualifier check and the poultry-egg check judge each keyword occurrence, so one unqualified occurrence flags.
- [ ] The meat list adds at least meat, mutton, rabbit, lardons, pastrami and guanciale. Bare "goat" stays out ("goat cheese").
- [ ] Must-flag test rows: "vegetable beef soup" → meat, "soy chicken" → poultry, "mushroom beef" → meat, "chicken egg noodles with chicken" → poultry, plus each new meat word. The existing must-not-flag rows ("veggie bacon", "vegan gelatin", "quail eggs" and the rest) still pass.
- [ ] `parseTimeEstimateMinutes` sums listed parts ("Prep 10 min, cook 25 min" → 35), or returns null for them, while a range ("20-30 min") still reads as 30. Tests for both.
- [ ] After merge, re-run `server/scripts/backfill-recipe-allergens.ts` on prod, which refreshes `diet_conflicts`.

## Implementation Notes

- `shared/constants/diet-conflicts.ts` (`PLANT_QUALIFIERS`, `CONFLICT_KEYWORDS`, `conflictKeywordHits`)
- `shared/constants/__tests__/diet-conflicts.test.ts`
- `shared/lib/recipe-time.ts`, `shared/lib/__tests__/recipe-time.test.ts`
- No migration is needed. The backfill is re-runnable and is the supported refresh path.

## Updates

### 2026-10-17

- Filed from the attribute-icons PR review (baseline code-reviewer, advisory verdict).
