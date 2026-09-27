---
title: "Beverage logging saves per-100 g nutrition as the whole drink: a can of soda = whiskey and soda"
status: done
priority: high
created: 2026-09-27
updated: 2026-09-27
assignee:
labels: [nutrition, beverages]
github_issue:
---

# Beverage logging saves per-100 g nutrition as the whole drink: a can of soda = whiskey and soda

## Summary

`POST /api/beverages/log` (`server/routes/beverages.ts`) looks up `"<oz>oz <beverage>"` and
writes the result straight to the diary. The lookup returns **per-100 g** values, so
every logged drink except water is wrong, usually far too low. Some queries also match the
wrong drink. Scale to the chosen size, which is known exactly (`BEVERAGE_SIZES[size].ml`),
and look up the drink by name.

## Background

This is the same defect class as Quick Log (fixed in PR #1118, archived todo
`todos/archive/P1-2026-09-26-quick-log-calories-are-per-100g-not-per-portion.md`). The user
approved filing it on 2026-09-27 ("file the rest").

Measured through `lookupNutrition` on the local server, 2026-09-27, with query shapes the
route can actually build (`BEVERAGE_TYPES` is `water, coffee, tea, milk, soda, custom`;
modifiers are `cream`, `sugar`):

| Query (path)                           | Match                                  | kcal | servingSize |
| -------------------------------------- | -------------------------------------- | ---- | ----------- |
| `12oz coffee` (standard)               | Coffee, brewed                         | 1    | 100g        |
| `12oz tea` (standard)                  | Tea, bubble                            | 55   | 100g        |
| `12oz soda` (standard)                 | Whiskey and soda                       | 59   | 100g        |
| `12oz milk` (standard)                 | Coconut milk                           | 31   | 100g        |
| `12oz coffee with milk and sugar` (\*) | Potato, mashed, dehydrated, granules … | 108  | 100g        |
| `16oz latte` (custom name "latte")     | Coffee, Iced Latte                     | 27   | 100g        |

(\*) A modifier-shaped query. The real modifiers are `cream`/`sugar`, so re-measure
`12oz coffee with cream and sugar`. The shape (size plus a "with … and …" tail) is what
the route builds.

- **Scaling:** the route copies `nutrition.calories` etc. and `servingSize: "100g"` onto a
  drink the user sized as 240/355/475 ml. A 355 ml can of soda should be roughly 140 kcal;
  a 16 oz latte roughly 190, not 27.
- **Matching:** `buildNutritionQuery` puts the size (`12oz`) and a bare type word into the
  search text. That's how soda matched "Whiskey and soda", milk matched coconut milk, and
  tea matched bubble tea.
- **Micronutrients too:** the route also saves `nutrition.fiber`, `sugar` and `sodium`
  unscaled (`server/routes/beverages.ts:116-118`), so they're per 100 g as well.
- The custom-name path (`${oz}oz ${customName}`) has the same shape.

## Acceptance Criteria

- [x] A logged beverage's calories, protein, carbs, fat, **fiber, sugar and sodium** all
      describe the whole chosen size: the lookup
      result is normalized to per 100 g through its `servingSize` and scaled by
      `BEVERAGE_SIZES[size].ml` (ml ≈ g). A per-serving result (API Ninjas) is never
      scaled twice.
- [x] The lookup query has no size and names the drink specifically enough to match it
      (e.g. `soda` → a cola, `milk` → cow's milk, `tea` → brewed tea). Modifiers are kept.
      **Amended 2026-09-27:** modifiers are kept as separate lookups at a fixed amount
      (1 tbsp table cream, 1 tsp sugar) added to the drink, not in the query text. Measured:
      "brewed coffee with cream and sugar" returns plain "Coffee, brewed" (modifiers
      dropped), "coffee with cream" returns coffee cake, and "brewed tea with cream" returns
      hibiscus tea.
- [x] Standard beverages resolve to sane values. Record a before/after table in Updates
      for every `BeverageType` at the medium size, measured live through `lookupNutrition`.
- [x] The saved `servingSize` describes the drink (e.g. `"355 ml"`), not `"100g"`.
- [x] Custom beverages with a name get the same treatment. Custom beverages with raw
      calories are unchanged.
- [x] Route tests (`server/routes/__tests__/beverages.test.ts`) cover scaling from a
      per-100 g result, no double scaling of a per-serving result, and the query shape.

## Implementation Notes

- Reuse the Quick Log conversion rather than writing a second one: `toPortion` in
  `server/services/food-nlp.ts` already does basis parsing (`parseServingGrams`) and
  scaling (`scaleNutrients`, both in `barcode-lookup.ts`). **It only returns
  calories/protein/carbs/fat**, and its internal `scaled()` drops the fiber/sugar/sodium
  that `scaleNutrients` already computes. Widen it to all seven nutrients when you extract
  it; the beverage route needs them.
- **Shared helper location:** extract `toPortion` to `server/services/portion-nutrition.ts`
  (Quick Log imports it from there). Whichever of this todo and
  `todos/P1-2026-09-27-photo-and-cooking-nutrition-use-per-100g-as-the-portion.md` lands
  first does the extraction; the other imports it.
- Beverage sizes are exact, so no estimate is needed. This is simpler than Quick Log.
- A small per-`BeverageType` lookup-name map (e.g. `soda` → "carbonated drinks, cola",
  `milk` → "milk, fluid, partly skimmed, 2%") is acceptable, and probably needed: bare type
  words match badly.
  Measure first.
- The CNF matcher and cultural-alias substring fixes (running in parallel, 2026-09-27)
  change which foods some queries match. Re-measure after they merge rather than
  hard-coding around today's matches.
- Entries already logged stay wrong. Correcting historical diary data is a separate,
  user-approved decision.

## Scope Contract

- **Mechanisms to use:** the existing `lookupNutrition` chain, `parseServingGrams` /
  `scaleNutrients`, and the Quick Log `toPortion` conversion (moved to a shared helper if
  reused). Nothing new beyond an optional per-beverage lookup-name map.
- **Files in scope:**
  - `server/routes/beverages.ts`
  - `server/routes/__tests__/beverages.test.ts`
  - `server/services/food-nlp.ts` and `server/services/portion-nutrition.ts` (new), for the
    `toPortion` extraction, if this todo lands first
  - `shared/constants/beverages.ts` only for a lookup-name map
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. Re-measure after the CNF matcher / cultural-alias fix merges.

## Risks

- Changing the query shape changes cache keys. Old `"12oz latte"` entries simply stop
  being read and expire on the 7-day TTL.
- Custom beverages go through `customName`, which is free text. Scale them the same way,
  but their match quality is only as good as the name the user typed.

## Updates

### 2026-09-27

- Found while reviewing PR #1118 (Quick Log per-100 g fix). The user approved filing it.
- PR #1119 review: removed an unreachable `orange_juice` example (it isn't a
  `BeverageType`), re-measured with reachable queries, flagged the unscaled
  fiber/sugar/sodium, and fixed the route path.

### 2026-09-27 (fixed)

- The route looks each drink up by a specific name (`BEVERAGE_LOOKUP_NAMES`: coffee →
  "coffee, brewed", tea → "tea, brewed", milk → "milk, 2%", soda → "cola") and scales it to
  `BEVERAGE_SIZES[size].ml` through the shared `scaleToGrams`
  (`server/services/portion-nutrition.ts`, all seven nutrients). Each modifier is looked up
  separately (`BEVERAGE_MODIFIER_PORTIONS`) and added at a fixed amount. A custom name is
  looked up bare. A result whose basis can't be weighed keeps its values and serving size,
  unless modifiers are requested or it has no serving size at all (422, review follow-up).
- `toPortion` stays in `food-nlp.ts` as a thin wrapper that formats Quick Log's serving
  size; the shared conversion it calls is `scaleToGrams`. The photo/cooking P1 should reuse
  `scaleToGrams`.
- **Baseline drift:** the table above was measured before #1120/#1123. On `main` at
  `90e39f3a`, bare "coffee" matches instant coffee powder and "soda" a saltine cracker, so
  scaling without the lookup names would have made coffee ~1,260 kcal.
- Measured through the route with the real lookup chain (cache read bypassed; auth and
  storage mocked), `main` `90e39f3a` vs this branch:

| Drink (size)                    | before: kcal, what it matched                   | after: kcal (servingSize)        |
| ------------------------------- | ----------------------------------------------- | -------------------------------- |
| coffee (medium)                 | 355, instant coffee with chicory, powder (100g) | 4 (355 ml)                       |
| coffee + cream + sugar (medium) | 16, pre-sweetened coffee, no cream (100g)       | 47 (355 ml)                      |
| tea (medium)                    | 1, per 100 g (100g)                             | 4 (355 ml)                       |
| tea + sugar (medium)            | 27, iced green tea, pre-sweetened (100g)        | 19 (355 ml)                      |
| milk (medium)                   | 496, dry whole milk powder (100g)               | 178, 2% milk (355 ml)            |
| soda (medium)                   | 418, saltine cracker; 941 mg sodium (100g)      | 146, cola; 14 mg sodium (355 ml) |
| custom "latte" (large)          | 39 (100g)                                       | 185 (475 ml)                     |
| custom "orange juice" (medium)  | 45 (100g)                                       | 160 (355 ml)                     |
| custom "beer" (medium)          | 29 (100g)                                       | 103 (355 ml)                     |

- Water and raw-calorie custom drinks are unchanged (no lookup).
