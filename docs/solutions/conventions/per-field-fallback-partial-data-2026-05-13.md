---
title: Per-field fallback for partial data from external APIs
track: knowledge
category: conventions
module: server
tags: [api, external-api, nullish-coalescing, fallback]
applies_to: [server/services/**/*.ts, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Per-field fallback for partial data from external APIs

## Rule

When consuming external APIs that may return partial data, use nullish coalescing (`??`) per-field rather than an all-or-nothing fallback gated by a single sentinel field.

## Why

External APIs often have inconsistent data coverage. A product might have per-serving calories but only per-100g fiber data. Per-field fallback ensures you get the best available data for each field instead of discarding everything because one sentinel field is missing.

## Examples

```typescript
// Good: Each field falls back independently
const nutriments = apiResponse.nutriments || {};

setNutrition({
  calories: nutriments["energy-kcal_serving"] ?? nutriments["energy-kcal_100g"],
  protein: nutriments.proteins_serving ?? nutriments.proteins_100g,
  carbs: nutriments.carbohydrates_serving ?? nutriments.carbohydrates_100g,
  fat: nutriments.fat_serving ?? nutriments.fat_100g,
  fiber: nutriments.fiber_serving ?? nutriments.fiber_100g,
});
```

```typescript
// Bad: All-or-nothing fallback loses partial data
const hasServingData = nutriments["energy-kcal_serving"] !== undefined;

setNutrition({
  calories: hasServingData
    ? nutriments["energy-kcal_serving"]
    : nutriments["energy-kcal_100g"],
  protein: hasServingData
    ? nutriments.proteins_serving // Could be undefined even when hasServingData is true!
    : nutriments.proteins_100g,
  // ...
});
```

## When to use

External APIs (OpenFoodFacts, nutrition databases, third-party services) where different fields may have different data availability.

## See Also

- [Indicate data source to users](indicate-data-source-to-users-2026-05-13.md)
- [Cross-validation between data sources](../design-patterns/cross-validation-between-data-sources-2026-05-13.md)
