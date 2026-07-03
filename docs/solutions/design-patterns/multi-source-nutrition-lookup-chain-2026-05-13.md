---
title: Multi-source lookup chain with priority fallback
track: knowledge
category: design-patterns
module: server
tags: [api, external-api, fallback, nutrition, priority]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Multi-source lookup chain with priority fallback

## When this applies

Any feature requiring reliable data from external sources where no single API has complete coverage (nutrition, product catalogs, geocoding, etc.). Use a priority chain of sources, returning as soon as a source produces usable data.

## Why

Individual APIs have gaps. OFF may have French names that confuse USDA. CNF is authoritative for Canadian products. The chain ensures the best available data for each query without forcing the caller to know which source has coverage.

## Examples

```typescript
// server/services/nutrition-lookup.ts
// Priority: CNF → USDA → API Ninjas
export async function lookupNutrition(
  query: string,
): Promise<NutritionData | null> {
  // 1. Try Canadian Nutrient File (bilingual, high accuracy)
  const cnfResult = await lookupCNF(query);
  if (cnfResult) return { ...cnfResult, source: "cnf" };

  // 2. Try USDA FoodData Central
  const usdaResult = await lookupUSDA(query);
  if (usdaResult) return { ...usdaResult, source: "usda" };

  // 3. Last resort: API Ninjas
  const ninjasResult = await lookupAPINinjas(query);
  if (ninjasResult) return { ...ninjasResult, source: "api-ninjas" };

  return null;
}
```

## Related Files

- `server/services/nutrition-lookup.ts`

## See Also

- [Cross-validation between data sources](cross-validation-between-data-sources-2026-05-13.md)
- [Barcode padding normalization](../conventions/barcode-padding-normalization-2026-05-13.md)
