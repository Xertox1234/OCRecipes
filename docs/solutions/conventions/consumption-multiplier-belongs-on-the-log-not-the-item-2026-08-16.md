---
title: A per-item macro row must store UNSCALED per-serving values — a consumption multiplier belongs on the logging-event row, never baked into the item's own columns
track: knowledge
category: conventions
tags: [api, database, nutrition, architecture, data-provenance]
module: server
applies_to: [server/routes/**/*.ts, server/storage/**/*.ts]
created: 2026-08-16
---

# A per-item macro row must store UNSCALED per-serving values — a consumption multiplier belongs on the logging-event row, never baked into the item's own columns

## Rule

When a write path logs "N servings of X," the item's own macro columns (`scannedItems.calories`/`protein`/`carbs`/`fat`/`fiber`/`sugar`/`sodium`) must always describe **one unscaled serving** — the same serving `servingSize` names. The consumption multiplier (`N`) belongs on the **logging-event row** instead (`dailyLogs.servings` for a direct scan-and-log; `mealPlanItems.servings` for a planned meal), never multiplied into the item's macros before the write.

Readers that need a total multiply at read time: `getDailySummary` (`* dailyLogs.servings`) or `getPlannedNutritionSummary` (`* mealPlanItems.servings`). Any new aggregate must follow the same shape — **and must COALESCE the multiplier, not just the macro**:

```sql
COALESCE(SUM(
  COALESCE(CAST(item.<macro> AS DECIMAL), CAST(recipe.<macro>PerServing AS DECIMAL), 0)
  * COALESCE(CAST(log.servings AS DECIMAL), 1)   -- <- the multiplier needs its own guard
), 0)
```

Both `dailyLogs.servings` and `mealPlanItems.servings` are `decimal(...).default("1")` with **no `.notNull()`**, and their `CHECK (servings > 0)` constraint does not reject NULL — SQL evaluates `NULL > 0` to `unknown`, and a CHECK passes on anything that is not `false`. An unguarded multiplier therefore fails toward silent under-reporting: `macro * NULL` is NULL, `SUM()` skips NULLs, and the outer `COALESCE(SUM(...), 0)` absorbs the gap, so the row contributes ZERO with no error anywhere. Coalescing to `1` fails toward the column's own default (unscaled macros) instead — wrong by at most the multiplier, never by the whole row. Coalescing only the macro operand (the shape both aggregates originally had) does not help: the NULL is on the other side of the `*`.

## When this applies

Any write path that creates a `scannedItems` row (or an analogous "one product, N consumed" row) alongside a per-event log entry that has its own quantity/servings column. `createScannedItemWithLog` (`server/storage/nutrition.ts`) is the shared choke point for this today — its `logOverrides` parameter is where the multiplier goes.

## Why

`scannedItems.servingSize` and `scannedItems.<macro>` are a paired label: readers (the nutrient-band classifier, the item detail screen's "Per serving: {servingSize}" caption, the history list's "Serving: {servingSize}" caption, a CSV export) treat them as describing the SAME amount. Scaling only the macros by a per-logging-event multiplier while leaving `servingSize` at the label's own value desyncs that pair — the stored ratio (macro ÷ servingSize) no longer matches the real product, even though each individual write ("scale by servings" / "keep the label's own string") is locally reasonable. See the sibling lesson in `../logic-errors/persisted-label-desyncs-from-its-scaled-companion-values-2026-07-16.md` — same failure shape (a persisted label and its paired values computed from different bases), different write site.

This is easy to miss because the codebase's own read-time aggregates (`getDailySummary`, `getPlannedNutritionSummary`) already implement the correct convention — store unscaled, multiply at read time via an independent servings/quantity column that already exists in the schema. A write path that instead pre-multiplies the item's own macros silently diverges from a convention the rest of the codebase already follows, and the daily-log TOTAL still comes out numerically correct (old: `scaled_macro * 1`; the divergence only corrupts the PER-ITEM ratio, which is exactly what a routine "does the total look right" check will not catch).

## Examples

```typescript
// WRONG — server/routes/photos.ts (confirm-label, pre-fix): bakes the
// multiplier into the item's own macros while servingSize stays unscaled.
const scaledSugar = clamp(labelData.totalSugars) * servingsConsumed;
await storage.createScannedItemWithLog({
  servingSize: labelData.servingSize, // e.g. "150 g" — UNSCALED
  sugar: scaledSugar.toString(), // e.g. 3x the label's own value — SCALED
});

// RIGHT — unscaled macros; the multiplier travels on the log entry instead.
const perServingSugar = clamp(labelData.totalSugars);
await storage.createScannedItemWithLog(
  {
    servingSize: labelData.servingSize, // "150 g"
    sugar: perServingSugar.toString(), // matches "150 g", not a multiple of it
  },
  { servings: servingsConsumed.toString() }, // -> dailyLogs.servings
);
```

`createScannedItemWithLog`'s `logOverrides` type (`server/storage/nutrition.ts`) is `Partial<Pick<InsertDailyLog, "mealType" | "source" | "servings">>` — `servings` defaults to `"1"` when omitted, matching every OTHER caller (barcode scan, photo-meal confirm, beverage log, cook-session log) that has no per-event multiplier concept.

## Exceptions

A write path with no independent multiplier concept (a plain barcode scan, a photo-meal confirm summing already-eaten foods) should omit `logOverrides.servings` and take the `"1"` default — do not invent a multiplier where none exists.

## Migrating an existing write path: the "no backfill needed" claim is per-reader, not global

Flipping a pre-scaling write path to this convention needs no backfill **for the aggregate that reads the same log row the old write path created**. Historical `confirm-label` rows carry `dailyLogs.servings = "1"` alongside already-scaled macros, so `getDailySummary`'s `scaled_macro * 1` still lands on the historical total — correct by construction.

That reasoning does **not** transfer to a second aggregate reading the same item row through a *different* multiplier column. `POST /api/meal-plan/items` (`server/routes/meal-plan.ts`) lets a user attach an **existing** `scannedItemId` to a meal plan with its own `mealPlanItems.servings`; a historical pre-fix (already-scaled) item attached that way with `servings > 1` is double-scaled by `getPlannedNutritionSummary` and over-reports. The pre-fix write path never created a `mealPlanItems` row itself, so this needs a separate user action and is neither introduced nor worsened by the convention change — but it is the reason the claim must be stated as "no backfill needed **for `getDailySummary`**" rather than unqualified. When migrating a write path, enumerate every aggregate that can reach the item row, not just the one the write path itself feeds.

## Related Files

- `server/routes/photos.ts` — `POST /api/photos/confirm-label`, the write site this rule was extracted from
- `server/storage/nutrition.ts` — `createScannedItemWithLog`'s `logOverrides.servings` threading
- `server/storage/nutrition.ts` — `getDailySummary`, the pre-existing read-time multiplication this rule aligns with
- `server/storage/meal-plan-analytics.ts` — `getPlannedNutritionSummary`, the sibling read-time multiplication (via `mealPlanItems.servings`)

## See Also

- [A persisted serving-size label and its scaled nutrition values must derive from the same base](../logic-errors/persisted-label-desyncs-from-its-scaled-companion-values-2026-07-16.md) — the sibling lesson: a persisted label and the values paired with it must come from the SAME base, whichever write site does the pairing
- [dailyLogs.recipeId references only mealPlanRecipes (intentional)](daily-logs-recipe-id-references-meal-plan-only-2026-05-13.md) — another `dailyLogs`-shape design decision recorded as a convention rather than re-derived per read
