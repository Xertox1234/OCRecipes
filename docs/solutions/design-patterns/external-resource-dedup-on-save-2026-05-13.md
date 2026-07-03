---
title: External resource dedup on save (userId + externalId lookup)
track: knowledge
category: design-patterns
module: server
tags: [api, external-api, dedup, storage, idempotency]
applies_to: [server/routes/**/*.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# External resource dedup on save (userId + externalId lookup)

## When this applies

Any feature that saves external resources into the local DB (catalog imports, bookmark/save flows, third-party sync). Check for an existing record by `externalId + userId` before fetching full details and inserting.

## Why

Users may tap "save" multiple times or revisit a catalog item. Without dedup, you get duplicate rows and wasted API quota. The `userId` scope ensures different users can independently save the same external resource — dedup is per-user, not global.

## Examples

```typescript
// In route handler — check for existing record before expensive API call
const existing = await storage.findMealPlanRecipeByExternalId(
  req.userId!,
  externalId,
);
if (existing) {
  return res.json(existing); // Already saved, return existing
}

// Only now fetch full details from external API
const detail = await getCatalogRecipeDetail(externalId);
const saved = await storage.createMealPlanRecipe(detail);
res.status(201).json(saved);
```

```typescript
// In storage layer — composite lookup by userId + externalId
async findMealPlanRecipeByExternalId(
  userId: string,
  externalId: string,
): Promise<MealPlanRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(mealPlanRecipes)
    .where(
      and(
        eq(mealPlanRecipes.userId, userId),
        eq(mealPlanRecipes.externalId, externalId),
      ),
    );
  return recipe;
}
```

## Schema note

`req.userId` and `mealPlanRecipes.userId` are both UUID strings (`varchar`), not numbers — the column references `users.id` which is `varchar`. Use `string` for the parameter type. The pair `(userId, externalId)` is enforced as a unique index in `shared/schema.ts` (`meal_plan_recipes_user_external_id_idx`).

## Related Files

- `server/routes/recipe-catalog.ts` — `POST /api/meal-plan/catalog/:id/save`
- `server/storage/meal-plan-recipes.ts` — `findMealPlanRecipeByExternalId`
- `shared/schema.ts` — `meal_plan_recipes_user_external_id_idx` unique constraint

## See Also

- [External data ingestion quality gate](external-data-ingestion-quality-gate-2026-05-13.md)
