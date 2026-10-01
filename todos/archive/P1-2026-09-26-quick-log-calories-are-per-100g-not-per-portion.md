---
title: 'Quick Log logs per-100 g nutrition as if it were the portion: "2 eggs" = 470 kcal'
status: done
priority: high
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [nutrition, ai-prompting, quick-log]
github_issue:
---

# Quick Log logs per-100 g nutrition as if it were the portion: "2 eggs" = 470 kcal

## Summary

Text and voice Quick Log return nutrition values per 100 g, labelled `servingSize: "100g"`,
and the client logs them as the user's actual portion. The quantity the user typed is never
applied. Every Quick Log entry's calories and macros are wrong, usually inflated. Scale
each item to the portion the user described.

## Background

Measured on the local server on 2026-09-26 (`POST /api/food/parse-text`, demo account):

| Input                               | Item returned                   | kcal | protein | carbs | servingSize |
| ----------------------------------- | ------------------------------- | ---- | ------- | ----- | ----------- |
| "2 eggs and toast"                  | egg, qty 2, piece               | 470  | 4.13    | 17.6  | 100g        |
|                                     | whole wheat toast, qty 1, slice | 305  | 9.2     | 56.4  | 100g        |
| "a chicken caesar salad and a coke" | coca-cola, qty 1, can           | 192  | 0       | 12.1  | 100g        |

Two eggs are about 140–160 kcal and a slice of whole-wheat toast about 70–100 kcal, so the
drawer showed "775 cal total" for roughly 250. The user approved filing this (2026-09-26).

**Cause (read from the code, 2026-09-26):**

- `server/services/food-nlp.ts` (`parseNaturalLanguageFood`, the only caller is
  `server/routes/food.ts` → `/api/food/parse-text`) asks the LLM for
  `{ name, quantity, unit }`, then calls `lookupNutrition(\`${quantity} ${unit} ${name}\`)`and copies`calories`/`protein`/`carbs`/`fat`/`servingSize`straight through. It
never scales by`quantity`or`unit`.
- `lookupNutrition` (`server/services/nutrition-lookup.ts`) tries CNF → USDA → API Ninjas.
  CNF and USDA return **per-100 g** values with `servingSize: "100g"` (e.g. `:541`,
  `:582`); a quantity inside the search text does not change that. Only the last-resort API
  Ninjas path reads the quantity from the query and returns a per-serving amount
  (`servingSize: \`${serving_size_g}g\``, `:282`).
- So whenever CNF or USDA matches (the normal case), the client receives per-100 g numbers,
  and `useQuickLogSession` logs them as the portion.
- **Match quality too:** the "egg" row (470 kcal, 17.6 g carbs, 4.1 g protein per 100 g) is
  not whole egg (about 143 kcal, 0.7 g carbs, 12.6 g protein per 100 g). Searching with the
  quantity and unit in the text ("2 piece egg") likely hurts CNF/USDA matching.
- **Cache:** results are cached under `normalizeForCache(query)` (lowercased full query,
  `:165`), so the wrong values are already cached under keys like `"2 piece egg"`. They are
  served again on the next identical phrase.

The client multiplies nothing either: `useQuickLogSession` sends `calories` as-is to
`POST /api/scanned-items` with `productName: "${quantity} ${unit} ${name}"`.

## Acceptance Criteria

- [x] Each parsed item's `calories`, `protein`, `carbs` and `fat` describe the whole portion
      the user typed. "2 eggs" (two large eggs) lands within a sensible range (about
      120–180 kcal), and "1 slice whole wheat toast" about 60–120 kcal.
- [x] `servingSize` describes that portion (e.g. `"2 large (100 g)"` or the grams used), not
      `"100g"`, so what the drawer shows and what gets logged agree.
- [~] The lookup matches the food itself (partly: see Updates, 2026-09-26 fix): "egg" resolves to whole egg (roughly 140–155 kcal
  per 100 g), not a dried or mixed egg product. Look up by food name, not by the
  "quantity unit name" string.
- [x] Results from every source (CNF, USDA, API Ninjas) are normalized to one basis
      (per 100 g) before scaling, so API Ninjas' per-serving values are not scaled twice.
- [x] Stale cache: entries written under quantity-bearing keys (e.g. `"2 piece egg"`) are
      no longer served to Quick Log, whether through a new key shape or by clearing them.
      Record which, and any production cache step, in Updates. **Production data changes
      need the user's explicit go-ahead.**
- [x] When the portion's weight can't be estimated, the item is still returned, clearly
      marked (e.g. `servingSize: "100 g (portion unknown)"`), never silently per-100 g.
- [x] Tests: `server/services/__tests__/food-nlp.test.ts` covers scaling from a per-100 g
      source, the API Ninjas per-serving case (no double scaling), and the unknown-weight
      case. `nutrition-lookup.test.ts` covers any change to normalization or keys.
- [x] An eval or fixture with a few common phrases ("2 eggs and toast", "a can of coke",
      "1 cup of rice") asserts each total falls in a sane range.

## Implementation Notes

- **Recommended shape:** have the parse prompt also return an estimated portion weight,
  e.g. `grams` for the whole item ("2 large eggs" → about 100). Look up by `name` alone,
  convert the result to per 100 g, then scale by `grams / 100`. The LLM already picks
  "standard serving sizes when unspecified", so it is the natural place to estimate grams.
  Validate `grams` with Zod (positive, with a sane upper bound) like the rest of the parse
  schema.
- Alternative: keep `{ quantity, unit }` and convert with a unit-to-grams table. More code
  and brittle for "piece" / "medium" / "can"; only worth it if the LLM estimate proves
  unreliable in the eval.
- API Ninjas returns `serving_size_g`. Divide by it to reach per 100 g before scaling.
- `shared/lib/nutrition-bands.ts` has `portionValueOf(per100, portionGrams)`, the same
  per-100 g → portion arithmetic, if it fits.
- Check the other `lookupNutrition` / `batchNutritionLookup` callers for the same
  per-100 g assumption, and note what you find. Don't widen this todo to fix them; file
  them.
- Prompt changes go through the ai-reviewer, and the prompt must keep its
  `SYSTEM_PROMPT_BOUNDARY` and input sanitization.

## Scope Contract

- **Mechanisms to use:** the existing parse schema + prompt in `food-nlp.ts`, the existing
  `lookupNutrition` chain, and Zod validation. Nothing new beyond one `grams` field (or a
  unit table, if the eval rules the estimate out).
- **Files in scope:**
  - `server/services/food-nlp.ts`
  - `server/services/nutrition-lookup.ts` (normalization / cache key only)
  - `server/services/__tests__/food-nlp.test.ts`, `server/services/__tests__/nutrition-lookup.test.ts`
  - `evals/` dataset or fixture for the sanity ranges
  - `client/hooks/useQuickLogSession.ts` only if the logged `servingSize` / `productName`
    must change to match
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Changing the cache key shape changes cache hit rates for every `lookupNutrition` caller.
  Measure it, or scope the new key to Quick Log.
- LLM gram estimates vary. Keep `temperature` low and bound the value; the eval shows
  whether it is good enough.
- Entries already logged with inflated values stay wrong. Correcting historical data is a
  separate, user-approved decision.

## Updates

### 2026-09-26

- Found while reproducing a Quick Log report on the simulator. The user approved filing
  ("yes file the calorie todo").

### 2026-09-26 — fix

- **Shape:** the parse prompt now also returns `grams` (whole-portion edible weight, with
  reference weights such as "1 large egg ≈ 50") and `lookupName` (database-style
  description, e.g. `"egg, chicken, whole, cooked"`). `food-nlp.ts` looks up
  `lookupName ?? name`, never the quantity string. Each result is normalized through the
  weight parsed from its `servingSize` (`parseServingGrams`), not its `source`, because a
  cache hit reports `source: "cache"`. It is then scaled to `grams` with `scaleNutrients`.
  An API Ninjas "250g" basis is therefore divided back to per 100 g first and never scaled
  twice. Invalid `grams`/`lookupName` values degrade that one item; they never fail the
  parse. Unknown weight → per 100 g, `servingSize: "100 g (portion unknown)"`. An
  unweighable basis ("1 serving") is kept as-is with that label. **Scope note:** one
  field beyond the contract (`lookupName`), added because the AC's match-quality bullet
  needs it. `name` stays human-readable, since the client renders it in `productName`.
- **Live measurement (real LLM + real CNF/USDA, local server, 2026-09-26):**
  "2 eggs and toast" → egg 141 kcal (2 large, 100 g) + toast 92 kcal (1 slice, 30 g), in
  5 of 5 runs (was 470 + 305). "a can of coke" → 146 kcal (355 g). "1 cup of rice" →
  208 kcal (160 g). Banana 105 kcal (118 g).
- **Match quality, 18-food comparison through `lookupNutrition`:** the bare name resolved
  to the right food about 5/18 times ("rice" → sake, "avocado" → avocado oil at 885 kcal,
  "egg" → egg bagel). The descriptive `lookupName` did so about 11/18 times. Remaining
  misses come from CNF's `scoreCNFMatch` substring scoring, e.g. "almonds, raw" →
  "Guava, strawberry, raw" ("raw" inside "st**raw**berry"), "butter, salted" → sunflower
  seed butter, "juice, orange" → frozen orange dessert. That scorer is outside this
  todo's scope, affects every `lookupNutrition` caller, and was surfaced to the user as
  a separate HIGH finding.
- **Cache (AC 5):** handled by the new key shape. Quick Log now keys by food name, so the
  old `"2 piece egg"`-style entries are never read again and expire on their own 7-day
  TTL. **No production cache step.** Side effect: Quick Log now shares cache entries with
  the coach `lookup_nutrition` tool and `/api/nutrition/lookup`, which already key by name
  with the same per-100 g meaning.
- **Other callers with the same quantity-in-query, per-100 g-as-portion pattern (not
  fixed, surfaced to the user as HIGH):** `server/routes/photos.ts` (`attachNutrition`,
  `"${quantity} ${name}"`), `server/services/cooking-session.ts`
  (`"${quantity} ${unit} ${name}"`, both nutrition summaries), and
  `server/routes/beverages.ts` (`"${oz}oz ${name}"`, logged straight to the diary). The
  coach tool and `/api/nutrition/lookup` return `servingSize` with the values, so they're
  fine.
- The eval AC is met by a recorded-output fixture in `food-nlp.test.ts` ("sanity
  fixture"). `evals/` has no food-nlp runner, and adding one is out of scope.
