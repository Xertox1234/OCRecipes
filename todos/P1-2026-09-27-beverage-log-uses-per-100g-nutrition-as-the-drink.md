---
title: "Beverage logging saves per-100 g nutrition as the whole drink: a 16 oz latte = 27 kcal"
status: backlog
priority: high
created: 2026-09-27
updated: 2026-09-27
assignee:
labels: [nutrition, beverages]
github_issue:
---

# Beverage logging saves per-100 g nutrition as the whole drink: a 16 oz latte = 27 kcal

## Summary

`POST /api/beverages` (`server/routes/beverages.ts`) looks up `"<oz>oz <beverage>"` and
writes the result straight to the diary. The lookup returns **per-100 g** values, so
every logged drink except water is wrong, usually far too low. Some queries also match the
wrong drink. Scale to the chosen size, which is known exactly (`BEVERAGE_SIZES[size].ml`),
and look up the drink by name.

## Background

This is the same defect class as Quick Log (fixed in PR #1118, archived todo
`todos/archive/P1-2026-09-26-quick-log-calories-are-per-100g-not-per-portion.md`). The user
approved filing it on 2026-09-27 ("file the rest").

Measured through `lookupNutrition` on the local server, 2026-09-27, with the exact query
shapes `buildNutritionQuery` produces:

| Query               | Match              | kcal | servingSize |
| ------------------- | ------------------ | ---- | ----------- |
| `12oz coffee`       | Coffee, brewed     | 1    | 100g        |
| `16oz latte`        | Coffee, Iced Latte | 27   | 100g        |
| `12oz orange_juice` | 12OZ Lime Seltzer  | 0    | 100g        |
| `8oz milk`          | Coconut milk       | 31   | 100g        |

- **Scaling:** the route copies `nutrition.calories` etc. and `servingSize: "100g"` onto a
  drink the user sized as 240/355/475 ml. A 16 oz latte should be roughly 190 kcal, not 27.
- **Matching:** `buildNutritionQuery` puts the size (`12oz`) and the raw enum key
  (`orange_juice`, with the underscore) into the search text. That's how orange juice
  matched a 0-kcal lime seltzer, and why milk matched coconut milk.
- The custom-name path (`${oz}oz ${customName}`) has the same shape.

## Acceptance Criteria

- [ ] A logged beverage's calories and macros describe the whole chosen size: the lookup
      result is normalized to per 100 g through its `servingSize` and scaled by
      `BEVERAGE_SIZES[size].ml` (ml ≈ g). A per-serving result (API Ninjas) is never
      scaled twice.
- [ ] The lookup query has no size and uses a readable drink name, not the enum key
      (`orange_juice` → "orange juice"). Modifiers are kept.
- [ ] Standard beverages resolve to sane values. Record a before/after table in Updates
      for every `BeverageType` at the medium size, measured live through `lookupNutrition`.
- [ ] The saved `servingSize` describes the drink (e.g. `"355 ml"`), not `"100g"`.
- [ ] Custom beverages with a name get the same treatment. Custom beverages with raw
      calories are unchanged.
- [ ] Route tests (`server/routes/__tests__/beverages.test.ts`) cover scaling from a
      per-100 g result, no double scaling of a per-serving result, and the query shape.

## Implementation Notes

- Reuse the Quick Log conversion rather than writing a second one: `toPortion` in
  `server/services/food-nlp.ts` already does basis parsing (`parseServingGrams`) and
  scaling (`scaleNutrients`, both in `barcode-lookup.ts`). Extracting it to a shared
  helper is in scope if both callers use it.
- Beverage sizes are exact, so no estimate is needed. This is simpler than Quick Log.
- If a standard drink still matches badly after the query fix, a small per-`BeverageType`
  lookup-name map (e.g. `latte` → "coffee latte, prepared with whole milk") is acceptable.
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
  - `server/services/food-nlp.ts` and one new shared helper module under `server/lib/` or
    `server/services/`, only if `toPortion` is extracted
  - `shared/constants/beverages.ts` only for a lookup-name map
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. Re-measure after the CNF matcher / cultural-alias fix merges.

## Risks

- Changing the query shape changes cache keys. Old `"12oz latte"` entries simply stop
  being read and expire on the 7-day TTL.

## Updates

### 2026-09-27

- Found while reviewing PR #1118 (Quick Log per-100 g fix). The user approved filing it.
