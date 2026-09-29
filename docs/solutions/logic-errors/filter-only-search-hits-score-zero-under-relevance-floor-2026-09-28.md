---
title: "Filter-only search hits score 0 and fall under a relevance floor — a request whose text is only filter words must browse the filters, and a retry must never drop a stated diet"
track: bug
category: logic-errors
tags: [ai-prompting, api, testing, search, recipe-finder, minisearch]
module: server
applies_to: ["server/services/recipe-finder/find-community.ts", "server/services/recipe-search.ts"]
symptoms: ["\"keto dinner\" and \"gluten free dinner\" show no community recipes although the catalog has matching ones", "\"vegan pasta\" shows a pasta that is not vegan", "Fixing the diet-tag spelling alone moves the gold set from 22 to 23 correct, and the dinner queries still return nothing"]
created: 2026-09-28
severity: medium
---

# Filter-only search hits score 0 and fall under a relevance floor

## Problem

`findCommunity` keeps hits scoring at least `max(CLOSE_MATCH_FLOOR = 8, 0.7 × best)`. For "keto dinner" and "gluten free dinner", three separate causes stacked:

1. **Vocabulary.** `extractQuery` emits Spoonacular's diet words (`ketogenic`, `gluten free`), while community `dietTags` use `keto` and `gluten-free`. The exact-match diet filter zeroed out.
2. **The retry dropped the diet.** On zero hits it retried text-only, so "vegan pasta" returned a non-vegan pasta.
3. **Text that repeats the filters.** "keto dinner" extracts `q: "dinner"`, which matches the text of 1 recipe in the 25-recipe catalog. Searching by the filters alone finds the right recipes (1 keto dinner, 12 gluten-free dinners, all in the gold set's right lists), but MiniSearch gives a hit with no text query a **score of 0**, under the floor of 8.

## Symptoms

- Gold set at (0.7, 8): 22/30 correct. After fixing cause 1 alone: 23/30, and both dinner queries still returned none.
- A probe of `searchRecipes` found the fix: `{q:"dinner", diet:"keto"}` returned 0 hits, `{diet:"keto", mealType:"dinner"}` returned 1, and every filter-only hit printed a score of 0.

## Root Cause

A relevance cut assumes every hit carries a text score. The meaning of that score changes when the request has no content words beyond the filters. Separately, a "relax on zero" retry that drops **every** filter treats a hard constraint (a stated diet) like a soft one (a meal type).

## Solution

(#1152, `server/services/recipe-finder/find-community.ts`)

- `communityDietTag()` maps diet words to community spellings, on the **community side only**. `findOnline` keeps Spoonacular's vocabulary.
- The retry drops only `mealType` and keeps the diet. A diet with no diet-safe hit returns no matches.
- `isFilterOnlyRequest()`: when a diet is stated and every word of the query text is a diet word or filler (meal types, "recipe", "ideas", …), browse by the filters. This means no `q`, no score cut, and at most `FINDER_MAX_ITEMS` results.

Result on the same gold set: 22/30 → **25/30** at (0.7, 8), still the best row of the sweep. "keto dinner" and "gluten free dinner" moved from none to right, and "vegan pasta" moved from wrong to none (the catalog has no vegan pasta).

## Prevention

- When one search leg has no text query, don't apply score thresholds to it. Either skip the cut or use a filter-only path.
- Classify each retry-relaxed filter as hard (diet, allergens) or soft (meal type, prep time). Only soft ones may be dropped.
- When measuring a fix for several stacked causes, re-run the sweep after each one. If a row that should have moved did not, there is another cause.

## Related Files

- `server/services/recipe-finder/find-community.ts` — `communityDietTag`, `isFilterOnlyRequest`, `findCommunity`
- `server/services/recipe-finder/__tests__/fixtures/finder-gold-set.json` — the pinned `measured` sets
- `server/services/recipe-finder/__tests__/close-match-gold-set.test.ts` — `MEASURE_FINDER_THRESHOLD=1 … -t sweep`

## See Also

- [a captured string never equals its stored copy — normalise both sides](a-captured-string-never-equals-its-stored-copy-normalise-both-sides-before-comparing-2026-09-22.md) — the vocabulary-mismatch half of this
- [food-name matcher: whole words + gold set](food-name-matcher-whole-words-gold-set-2026-09-27.md) — measure every matcher change as right/wrong/none
