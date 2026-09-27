---
title: "A quantity in a nutrition lookup query does not scale the result — CNF/USDA answer per 100 g whatever the query says, so \"2 eggs\" logged 470 kcal"
track: bug
category: logic-errors
tags: [architecture, ai-prompting, nutrition, unit-conversion, caching]
module: server
applies_to: [server/services/food-nlp.ts, server/services/nutrition-lookup.ts, server/services/cooking-session.ts, server/routes/photos.ts, server/routes/beverages.ts]
symptoms: ["A logged entry's calories are the food's per-100 g values regardless of the amount typed — \"2 eggs and toast\" = 470 + 305 kcal", "The lookup result carries servingSize \"100g\" while the UI shows the user's own quantity", "The only source that returns a per-serving value (API Ninjas) is the last-resort fallback, so the bug hides on the rare path that happens to work"]
created: 2026-09-27
severity: high
---

# A quantity in a nutrition lookup query does not scale the result — CNF/USDA answer per 100 g whatever the query says, so "2 eggs" logged 470 kcal

## Problem

Quick Log (`server/services/food-nlp.ts`) asked the LLM for `{ name, quantity, unit }`, called `lookupNutrition(\`${quantity} ${unit} ${name}\`)`, and copied `calories`/`protein`/`carbs`/`fat`/`servingSize` straight into the parsed item. The client logged those as the portion. "2 eggs and toast" came back as egg 470 kcal + toast 305 kcal, both labelled `servingSize: "100g"`.

Three more callers had the same shape and were filed as P1 todos (#1119): photo analysis (`"${quantity} ${name}"`), cooking sessions (`"${quantity} ${unit} ${name}"`), and beverage logging (`"${oz}oz ${name}"`, written straight to the diary).

## Symptoms

- Every logged value is per 100 g: usually inflated for dense foods, deflated for drinks (a 16 oz latte = 27 kcal).
- `servingSize: "100g"` on an item whose quantity says "2 large".
- The quantity also degrades matching: "2 piece egg" matched a 470 kcal/100 g egg product, not whole egg.

## Root Cause

`lookupNutrition` tries CNF → USDA → API Ninjas. CNF and USDA return **per-100 g** values labelled `"100g"`, and a quantity inside the search text changes neither the values nor the basis. Only API Ninjas parses a quantity from the query and returns a per-serving amount (`servingSize: "<n>g"`). The callers assumed the quantity in the query did the scaling.

A second trap sits behind the obvious fix: the basis cannot be read from `source`. `getCachedNutrition` rewrites `source` to `"cache"` on every hit, so after the first lookup you cannot tell a per-100 g CNF row from a per-serving API Ninjas row by its source.

## Solution

Look up the **food** and scale **afterwards** (PR #1118, `toPortion` in `server/services/food-nlp.ts`):

1. The LLM also returns `grams` (whole-portion edible weight, bounded 0 < g ≤ 5000, validated per item so a bad value degrades one item) and a database-style `lookupName` (`"egg, chicken, whole, cooked"`).
2. Look up `lookupName ?? name`, never the quantity string.
3. Normalize through the weight in the result's **`servingSize`** (`parseServingGrams`), never `source`: `factor = grams / basisGrams`. A per-serving API Ninjas result is thereby divided back to per 100 g first and never scaled twice.
4. Scale with `scaleNutrients`. Unknown weight → per 100 g with `servingSize: "100 g (portion unknown)"`. An unweighable basis ("1 serving") → keep values and label as-is. Never silently per 100 g.

Measured live: "2 eggs and toast" → 141 + 92 kcal (5 of 5 runs); a can of coke 146; 1 cup of rice 208. The LLM's gram estimate needed reference weights in the prompt ("1 large egg ≈ 50, so 2 ≈ 100"); without them it drifted to 136 g for two eggs.

The new fields cost ~46 completion tokens per item. Measure `usage.completion_tokens` on a long multi-item phrase before shipping: 13 items needed 597 tokens and would have truncated at the old 500 cap, failing the whole parse.

## Prevention

- Any caller of `lookupNutrition` / `batchNutritionLookup` that logs or displays values must scale them to a known portion through the result's `servingSize`. Grep the callers when touching the lookup chain. The copy-through shape recurs.
- Test a per-100 g source, a per-serving source (no double scaling), a **cache hit** (`source: "cache"`), and the unknown-weight case. A mock returning strings with a `productName` field (the old test) exercises none of these.
- When a result is scaled, make sure every nutrient the caller persists is scaled. `scaleNutrients` computes fiber/sugar/sodium; a helper that returns only four fields silently leaves the rest per 100 g.

## Related Files

- `server/services/food-nlp.ts`: `toPortion`, `parseNaturalLanguageFood`
- `server/services/nutrition-lookup.ts`: `lookupNutrition`, source chain, cache
- `server/services/barcode-lookup.ts`: `parseServingGrams`, `scaleNutrients`
- `todos/P1-2026-09-27-beverage-log-uses-per-100g-nutrition-as-the-drink.md`, `todos/P1-2026-09-27-photo-and-cooking-nutrition-use-per-100g-as-the-portion.md`: the remaining callers

## See Also

- [persisted-label-desyncs-from-its-scaled-companion-values](persisted-label-desyncs-from-its-scaled-companion-values-2026-07-16.md) — the same per-100 g vs per-serving basis mix-up, on the barcode cache write
- [food-name-matcher-whole-words-gold-set](food-name-matcher-whole-words-gold-set-2026-09-27.md) — why the looked-up food was often the wrong food, and how that was measured
