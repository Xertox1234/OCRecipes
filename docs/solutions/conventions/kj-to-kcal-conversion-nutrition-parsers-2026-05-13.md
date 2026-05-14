---
title: "kJ → kcal conversion in nutrition parsers"
track: knowledge
category: conventions
tags: [api, nutrition, units, parsing, external-api]
module: server
applies_to: ["server/services/**/*.ts"]
created: 2026-05-13
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

## Rules

- Conversion factor: `kcal = Math.round(kJ / 4.184)`
- Always guard with `Number.isFinite` before arithmetic — `parseFloat("abc")` returns `NaN`
- Always reject negative values — log a warning and return `null`
- Log unexpected units as warnings so future contract shifts are observable

## Related Files

- `server/services/recipe-import.ts` → `parseNutritionValue`
- `server/services/recipe-catalog.ts` → `findNutrient`

## Origin

Audit findings M19/M23 (2026-04-18).

## See Also

- [Unit normalization at API boundary (weight)](unit-normalization-at-api-boundary-weight-2026-05-13.md)
