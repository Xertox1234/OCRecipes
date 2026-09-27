---
title: kJ → kcal conversion in nutrition parsers
track: knowledge
category: conventions
module: server
tags: [api, architecture, nutrition, units, parsing, external-api]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
last_updated: '2026-09-27'
---

# kJ → kcal conversion in nutrition parsers

## Rule

Any parser or service that consumes nutrition values from third-party sources (LD+JSON on recipe websites, Spoonacular, USDA) must detect kJ and convert to kcal before storing.

## Why

Storing kJ directly would produce values ~4.18× too large — silently corrupting calorie data and goal tracking. The error is invisible to users until they notice their daily totals are wildly off.

## Examples

```typescript
// LD+JSON (recipe-import.ts) — detect from the value string
function parseNutritionValue(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/([\d.]+)\s*(kJ|KJ)?/i);
  if (!match) return null;
  let num = parseFloat(match[1]);
  if (!Number.isFinite(num) || num < 0) return null; // guard NaN and negatives
  if (match[2]) {
    num = Math.round(num / 4.184); // kJ → kcal
  }
  return String(num);
}

// Spoonacular (recipe-catalog.ts) — detect from the unit field
function findNutrient(nutrients: Nutrient[], name: string): number | null {
  const n = nutrients.find(
    (nut) => nut.name.toLowerCase() === name.toLowerCase(),
  );
  if (!n) return null;
  if (name.toLowerCase() === "calories" && n.unit !== "kcal") {
    log.warn(
      { unit: n.unit, amount: n.amount },
      "unexpected Calories unit — expected kcal",
    );
    if (n.unit === "kJ") return Math.round(n.amount / 4.184);
  }
  return n.amount;
}
```

### USDA FoodData Central: select the energy entry by `unitName`, never by name alone

A USDA search result lists nutrients as `{ nutrientName, unitName, value }`. SR Legacy
foods carry **two** entries named "Energy", one in kJ and one in KCAL, **in either order**
(a live sample of 278 SR Legacy foods: 185 kJ first, 93 kcal first). Foundation foods may
instead carry "Energy (Atwater General Factors)" / "(Atwater Specific Factors)" in kcal.
Branded and Survey (FNDDS) foods list kcal only, which is why the bug hid: most spot checks
hit kcal-only rows.

`mapUsdaFoodToNutrition` took the first nutrient whose name contained "Energy" and never
read the unit. Every kJ-first row stored kilojoules as calories, ~4.2× high, for every
caller that reached it (Quick Log, beverages, cooking, photos, barcode fallback). Live
2026-09-27: "Quinoa, cooked" stored 503 (120 kcal), "BURGER KING, CROISSAN'WICH" 1180 (283).
Fixed in #1128:

```typescript
// nutrition-lookup.ts — usdaKcal
const energy = nutrients.filter((n) =>
  n.nutrientName.toLowerCase().includes("energy"),
);
const unit = (n: UsdaNutrient) => n.unitName?.toLowerCase();
const kcal = energy.find((n) => unit(n) === "kcal") ?? energy.find((n) => !unit(n));
if (kcal) return kcal.value;
const kj = energy.find((n) => unit(n) === "kj");
return kj ? Math.round(kj.value / KJ_PER_KCAL) : 0;
```

The schema has to keep `unitName` for this to work (with `.catch(undefined)`, see
[zod-ingestion-validation-stricter-than-readers](../logic-errors/zod-ingestion-validation-stricter-than-readers-2026-05-29.md)).
Test fixtures must include a kJ-first entry: the pre-existing fixtures had one unit-less
"Energy" each, so they could not tell the two readers apart. After fixing, purge any cache
that stored the wrong values (#1128: `nutrition_cache` rows with `source = 'usda'`, sparing
the barcode-keyed label-scan seeds that share that source).

## Rules

- A nutrient list that can carry the same nutrient in two units must be read by unit. A
  first match by name is order-dependent, and the order is not stable.
- Conversion factor: `kcal = Math.round(kJ / 4.184)`
- Always guard with `Number.isFinite` before arithmetic — `parseFloat("abc")` returns `NaN`
- Always reject negative values — log a warning and return `null`
- Log unexpected units as warnings so future contract shifts are observable

## Related Files

- `server/services/recipe-import.ts` → `parseNutritionValue`
- `server/services/recipe-catalog.ts` → `findNutrient`
- `server/services/nutrition-lookup.ts` → `usdaKcal`, `mapUsdaFoodToNutrition` (USDA search and UPC, #1128)

## Origin

Audit findings M19/M23 (2026-04-18).

## See Also

- [Unit normalization at API boundary (weight)](unit-normalization-at-api-boundary-weight-2026-05-13.md)
