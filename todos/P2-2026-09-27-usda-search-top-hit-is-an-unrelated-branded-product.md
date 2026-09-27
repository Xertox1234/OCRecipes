---
title: 'USDA search takes the top hit even when it is an unrelated branded product: "doro wat" → hazelnut wafers'
status: backlog
priority: medium
created: 2026-09-27
updated: 2026-09-27
assignee:
labels: [deferred, nutrition, architecture]
github_issue:
---

# USDA search takes the top hit even when it is an unrelated branded product: "doro wat" → hazelnut wafers

## Summary

`lookupUSDA` (`server/services/nutrition-lookup.ts`) requests `pageSize=1` from the USDA
FoodData Central search and uses whatever comes back. For some dish names that top hit is a
branded product that shares one word or a fragment with the query. Two dishes got worse when
the cultural-map fix started sending the query as typed.

## Background

The P1 cultural-map fix (2026-09-27) made `fetchNutritionFromSources` try the query as typed
before the cultural map's standardized name. Measured through `lookupNutrition`, 20 of 31
queries improved and 4 regressed. Two of those ("taco", "2 tacos") are CNF ranking, in the
P3 matcher todo (item 7). These two regressed because USDA answered the original query with
a wrong product, and the standardized name is tried only when CNF and USDA both return
nothing:

| query    | before (standardized name)        | after (as typed)                                     |
| -------- | --------------------------------- | ---------------------------------------------------- |
| doro wat | "Stew, chicken" 84 kcal/100 g     | "BAMBI, YO DORO WAFERS WITH HAZELNUTS" [Branded] 522 |
| gyoza    | "STEAMED DUMPLINGS" [Branded] 224 | "GYOZA DIPPING SAUCE, GYOZA" [Branded] 133           |

Measured 2026-09-27 (POST `/fdc/v1/foods/search` with
`dataType: ["Survey (FNDDS)", "SR Legacy", "Foundation"]`): "doro wat" and "gyoza" return
**no** generic foods, while "injera" returns "Injera, Ethiopian bread" and "chicken bulgogi
bowl" returns "Burrito bowl, chicken". So a generic-first search would have returned nothing
for both, and the lookup would have fallen through to the standardized name as intended.

This affects every query that reaches USDA, not only cultural ones. After the cultural fix,
the map's standardized names are reached only when USDA returns nothing at all, which the
top-1 search almost never does. Every one of the 31 probed queries got a USDA hit.

## Acceptance Criteria

- [ ] "doro wat" and "gyoza" no longer resolve to the wafer / dipping-sauce rows. Record
      what they resolve to before and after.
- [ ] Measured over a query set that includes the 31 cultural-fix queries (listed in the
      cultural todo's Updates in `todos/archive/`), plus plain foods that reach USDA today
      ("chicken breast", "fish tacos", "chicken burrito", "pad thai", "jollof rice"):
      right / wrong / no-match before and after, through `lookupNutrition` with the cache
      bypassed. No query that is right today becomes wrong.
- [ ] USDA request count per lookup is stated before and after. The DEMO_KEY limit is 40
      requests/hour when `USDA_API_KEY` is unset.

## Implementation Notes

Two candidate designs; measure both if unsure:

1. **Generic data types first.** Search `Survey (FNDDS)`, `SR Legacy` and `Foundation`, and
   only then `Branded`. The branded pass keeps "JOLLOF RICE" and "PAD THAI", which have no
   generic rows (check this; it is not measured yet). This costs a second request on a
   generic miss.
2. **Whole-word coverage on the USDA description.** Take a few hits (`pageSize` 5) and keep
   the first whose description contains every query word, the rule `scoreCNFMatch` already
   applies to CNF. It rejects "DORO WAFERS" for "doro wat". It does not reject "GYOZA
   DIPPING SAUCE" for "gyoza".

- Cache: results are cached under the query for 7 days, so a fix reaches cached entries only
  as they expire.
- Measure through the shipped function, not a reimplementation. Pointing `DATABASE_URL` at an
  unreachable database makes the cache read fail soft, so `lookupNutrition` runs the live
  chain (this is how the cultural fix was measured).

## Scope Contract

- **Mechanisms to use:** the existing `lookupUSDA`, `usdaResponseSchema`, and, for design 2,
  `matchWords` / `wordMatch` from the CNF scorer.
- **Files in scope:**
  - `server/services/nutrition-lookup.ts`
  - `server/services/__tests__/nutrition-lookup.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- `todos/P3-2026-09-27-cnf-matcher-review-followups.md` touches the same file; don't run
  them in parallel.

## Risks

- Design 1 can turn a good branded answer into a worse generic one (e.g. a restaurant dish
  resolving to a generic ingredient). The measurement has to cover it.

## Updates

### 2026-09-27

- Filed from the cultural-map fallback fix (Medium, auto-filed).
