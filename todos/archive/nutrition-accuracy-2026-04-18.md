---
title: "Nutrition accuracy follow-ups from 2026-04-18 audit"
status: in-progress
priority: high
created: 2026-04-18
updated: 2026-04-18
labels: [nutrition, data-integrity, audit-2026-04-18]
---

# Nutrition accuracy follow-ups from 2026-04-18 audit

## Summary

Nutrition-domain correctness gaps. The H10 main-pass fix made community recipes pass-through macro filters as a bandaid — the durable fix is adding nutrition columns to `community_recipes` + backfilling seed/imported content. Also includes unit-parsing correctness and filter-semantics gaps.

## Findings (cross-ref `docs/audits/2026-04-18-full.md`)

### Schema + data model

- **H10-followup** — Add nutrition columns to `community_recipes` (`caloriesPerServing`, `proteinPerServing`, `carbsPerServing`, `fatPerServing`). Update `communityToSearchable` to read from real columns. Backfill via `nutrition-lookup` service per-ingredient aggregated by servings. Removes the `numericPassThrough` carve-out added in H10 fix.
- **L6** — Seed recipes have no nutrition data (no column in `community_recipes` today). Once H10-followup lands, extend `seedOneRecipe` to compute macros during content generation.
- **M25** — `weightLogs` has no unit column. Trend math `parseFloat(weight)` assumes consistent kg/lb. iOS HealthKit sync (kg) + manual UI (lb) produces nonsense projections. Add `unit: text("unit").default("lb")` column or server-side normalization before insert.
- **L3** — `calculateWeeklyRate` silently returns `NaN` on unparseable weight strings (coach context interpolates `"NaNkg/week"`). Add `Number.isFinite` guard, return `null`.

### Filter semantics

- **M22** — `maxPrepTime` query param filters `totalTimeMinutes` (prep+cook). A crockpot recipe with 10 min prep + 6h cook is excluded from `maxPrepTime=15`. Either rename param to `maxTotalTime` (breaking) or filter on `prepTimeMinutes`.
- **M23** — URL-imported nutrition `parseNutritionValue(/([\d.]+)/)` strips units. `"1046 kJ"` → stored as 1046 kcal (4.18× real calories). Detect `kJ` and convert (÷ 4.184) or reject.
- **M24** — URL imports often have no nutrition in schema.org; null values silently excluded from macro-filtered searches. Document behavior OR run nutrition estimation during import.
- **L5** — Spoonacular `findNutrient` doesn't validate `.unit` field. Vulnerable if API contract shifts (kcal→kJ). Add `if (n.unit !== "kcal") log.warn + normalize` for defense-in-depth.
- **L9** — `parseNutritionValue` regex accepts `"-10"` and returns `10` (stripped negative). Surface warning log for nonsense inputs.
- **L10** — `inferMealTypes` returns all four meal types on no-keyword-match — defeats the GIN index for "unclassified" recipes. Use `"unclassified"` tag + caller opt-in.

### Meal-type classification edge cases

- **L7** — Keyword heuristic: `salad`/`soup` only in lunch (dinner salads/stews common); `muffin` breakfast+snack only; no "breakfast burrito" multi-type. Review + extend `server/lib/meal-type-inference.ts`.
- **L8** — `source=spoonacular` accepted by search schema but MiniSearch index doesn't include it → silent empty result. Drop from enum OR federate to catalog service.
- **L27** — `inferMealTypes`: `"wrap"`/`"bowl"` appear in both `MEAL_TYPE_KEYWORDS.lunch` and `MULTI_TYPE_OVERRIDES` — dedup'd by Set, but dead entries.

## Acceptance Criteria

- [ ] `community_recipes` has nutrition columns + backfill job + `numericPassThrough` removed
- [ ] Seed recipes ship with real macros
- [ ] `weightLogs.unit` column + conversion at boundary
- [ ] `calculateWeeklyRate` NaN guard
- [ ] `maxPrepTime` filter semantics matches the param name
- [ ] kJ → kcal conversion on URL import
- [ ] Spoonacular unit validation
- [ ] Negative nutrition value warnings
- [ ] "unclassified" mealType handling
- [ ] Meal-type keyword coverage review

## Updates

### 2026-04-18

- Created from 2026-04-18 audit deferrals.
