---
title: "Recipe finder: diet words never match community tags ('ketogenic' vs 'keto', 'gluten free' vs 'gluten-free'), and the q-only retry drops the diet constraint"
status: backlog
priority: medium
created: 2026-09-28
updated: 2026-09-28
assignee:
labels: [deferred, ai-prompting]
github_issue:
---

# Recipe finder diet vocabulary + q-only retry drops the diet

## Summary

Task 10's close-match gold set, measured on the 25-recipe production catalog, found two diet-related misses:

1. **Vocabulary mismatch.** `extractQuery` emits diets from Spoonacular's vocabulary (`"ketogenic"`, `"gluten free"`, `"dairy free"`), but community `dietTags` use `"keto"`, `"gluten-free"`, `"dairy-free"`. The community `diet` filter therefore zeroes out. The q-only retry then searches just `"dinner"` and finds nothing above the floor. Result: "keto dinner" and "gluten free dinner" show "No community recipes matched" although the catalog has 4 and 13 genuine matches.
2. **The q-only retry drops the diet.** "vegan pasta": the vegan filter zeroes out, the retry drops `diet`, and it returns "Creamy Tomato and Spinach Pasta", which is not vegan. A stated diet preference is silently ignored. (Allergen filtering, `safeForMe`, is unaffected.)

## Background

Both are recoverable (the list still offers Search Spoonacular / Generate / None of these) and are outside Task 10's one tuning pass, so they are deferred. The evidence is the `wrong` / `none` sets pinned in `server/services/recipe-finder/__tests__/fixtures/finder-gold-set.json` (at `(0.7, 8)`: "keto dinner" and "gluten free dinner" are `none`, and "vegan pasta" is `wrong`).

## Acceptance Criteria

- [ ] Community search maps the finder's diet vocabulary onto community tag spellings (or normalizes both sides), so "keto dinner" and "gluten free dinner" find their catalog matches.
- [ ] The q-only retry keeps a stated diet (drop mealType only, or post-filter by diet), so "vegan pasta" never shows a non-vegan recipe; with no diet-safe hit, the result is "no matches".
- [ ] Re-run `MEASURE_FINDER_THRESHOLD=1 npx vitest run server/services/recipe-finder/__tests__/close-match-gold-set.test.ts -t sweep` and re-pin `measured` (report both the old and new rows).

## Implementation Notes

- Files: `server/services/recipe-finder/find-community.ts` (`run()` filters + retry), possibly `server/services/recipe-finder/extract-query.ts` (prompt diet list), `server/services/recipe-search.ts` (how `diet` matches `dietTags`).
- `findOnline` must keep Spoonacular's vocabulary; normalize only on the community side.

## Dependencies

- None (the recipe finder server PR must be merged first).

## Updates

### 2026-09-28

- Auto-filed (Medium) from the Task 10 gold-set measurement.
