---
title: External data ingestion quality gate (three-layer defense)
track: knowledge
category: design-patterns
module: server
tags: [api, external-api, validation, defense-in-depth, data-quality]
applies_to: [server/routes/**/*.ts, server/storage/**/*.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# External data ingestion quality gate (three-layer defense)

## When this applies

When saving data from external APIs (Spoonacular, recipe URLs, third-party catalogs), validate that the record meets a **minimum content threshold** before persisting. Apply this as defense-in-depth across three layers.

## Why

External catalogs contain partial or empty records. Without quality gates these records get saved to the DB and surface in user-facing lists as broken entries. The three layers each catch a different failure mode:

- **Layer 1** reduces API quota waste on unusable records
- **Layer 2** gives the client an actionable error (422) instead of silently saving empty data
- **Layer 3** catches records that were saved before the gate existed (retroactive safety net)

## Examples

```typescript
// Layer 1: API parameters — ask the source to pre-filter
url.searchParams.set("instructionsRequired", "true");

// Layer 2: Route-level validation — reject before saving
const hasInstructions =
  detail.recipe.instructions &&
  Array.isArray(detail.recipe.instructions) &&
  detail.recipe.instructions.length > 0;
const hasIngredients = detail.ingredients && detail.ingredients.length > 0;
if (!hasInstructions && !hasIngredients) {
  sendError(
    res,
    422,
    "This recipe has no instructions or ingredients",
    ErrorCode.VALIDATION_ERROR,
  );
  return;
}

// Layer 3: Query-level filtering — hide existing bad data
const conditions = [
  sql`COALESCE(jsonb_array_length(${table.instructions}), 0) > 0`,
];
```

## Related Files

- `server/routes/recipes.ts` — catalog save and URL import endpoints
- `server/storage/community.ts`, `server/storage/meal-plans.ts` — query filters

## See Also

- [External resource dedup on save](external-resource-dedup-on-save-2026-05-13.md)
- [Zod safeParse for external API responses](../conventions/zod-safeparse-external-api-responses-2026-05-13.md)
