---
title: Cross-validation between primary and secondary data sources
track: knowledge
category: design-patterns
module: server
tags: [api, external-api, validation, data-quality, fallback]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Cross-validation between primary and secondary data sources

## When this applies

Any integration where the primary source may have inaccurate data (e.g., community-contributed databases like Open Food Facts). When primary data is suspect, compare against a secondary source and prefer the more plausible result.

## Why

OFF sometimes reports nutrition for the full box instead of one serving (e.g., 944 kcal for a Keurig pod box instead of 60 kcal for one pod). Cross-validation catches these errors automatically without requiring a manual data-quality audit per product.

## Examples

```typescript
// If OFF reports >2× the calories of the secondary source, prefer secondary
const offCalories = offData.calories;
const secondaryCalories = secondaryData.calories;

if (offCalories > secondaryCalories * 2) {
  // OFF likely has a full-box serving size; prefer secondary
  return { ...secondaryData, productName: offData.productName };
}

// Sources agree: use OFF but fill gaps from secondary
return {
  ...offData,
  fiber: offData.fiber ?? secondaryData.fiber,
  sugar: offData.sugar ?? secondaryData.sugar,
};
```

## Related Files

- `server/services/nutrition-lookup.ts` — cross-validation logic in `lookupBarcode()`

## See Also

- [Multi-source nutrition lookup chain](multi-source-nutrition-lookup-chain-2026-05-13.md)
- [Per-field fallback for partial data from external APIs](../conventions/per-field-fallback-partial-data-2026-05-13.md)
- [A similarity-matched secondary source must never replace identity-matched, self-consistent label data](../logic-errors/name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md) — the replace-on-discrepancy arm of this pattern produced a live 3× calorie error when the name-matched secondary was a different food; a self-consistent primary now demotes the secondary to gap-fill only
