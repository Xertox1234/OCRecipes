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

Readers that need a total multiply at read time: `SUM(scannedItems.<macro> * dailyLogs.servings)` (`getDailySummary`) or `* mealPlanItems.servings` (`getPlannedNutritionSummary`). Any new aggregate must follow the same shape.

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

## Related Files

- `server/routes/photos.ts` — `POST /api/photos/confirm-label`, the write site this rule was extracted from
- `server/storage/nutrition.ts` — `createScannedItemWithLog`'s `logOverrides.servings` threading
- `server/storage/nutrition.ts` — `getDailySummary`, the pre-existing read-time multiplication this rule aligns with
- `server/storage/meal-plan-analytics.ts` — `getPlannedNutritionSummary`, the sibling read-time multiplication (via `mealPlanItems.servings`)

## See Also

- [A persisted serving-size label and its scaled nutrition values must derive from the same base](../logic-errors/persisted-label-desyncs-from-its-scaled-companion-values-2026-07-16.md) — the sibling lesson: a persisted label and the values paired with it must come from the SAME base, whichever write site does the pairing
- [dailyLogs.recipeId references only mealPlanRecipes (intentional)](daily-logs-recipe-id-references-meal-plan-only-2026-05-13.md) — another `dailyLogs`-shape design decision recorded as a convention rather than re-derived per read
