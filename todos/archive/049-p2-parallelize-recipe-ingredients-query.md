---
title: "P2: Parallelize recipe + ingredients queries"
status: backlog
priority: medium
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [performance, p2, meal-plan]
---

# P2: Parallelize recipe + ingredients queries

## Summary

`getMealPlanRecipeWithIngredients` runs two sequential database queries that could run in parallel with `Promise.all`.

## Background

`server/storage.ts:720-735` — first fetches the recipe by ID, then fetches ingredients. Both are indexed lookups. Running sequentially doubles the wall-clock time.

## Acceptance Criteria

- [ ] Use `Promise.all` to run recipe and ingredients queries concurrently
- [ ] Return `undefined` if recipe not found
- [ ] ~40-50% latency improvement on recipe detail endpoint

## Implementation Notes

```typescript
const [recipeResult, ingredients] = await Promise.all([
  db.select().from(mealPlanRecipes).where(eq(mealPlanRecipes.id, id)),
  db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, id))
    .orderBy(recipeIngredients.displayOrder),
]);
```

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
