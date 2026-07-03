---
title: Cross-user aggregation with self-exclusion
track: knowledge
category: design-patterns
module: server
tags: [database, aggregation, recommendations, community, drizzle]
applies_to: [server/storage/**/*.ts, server/routes/**/*.ts]
created: '2026-05-13'
---

# Cross-user aggregation with self-exclusion

## When this applies

When surfacing community-level data (e.g., "popular picks", "trending recipes") derived from other users' actions, exclude the requesting user's own records and aggregate by distinct users rather than raw row count. This prevents self-reinforcement and ensures the data reflects genuine community signal.

## Examples

```typescript
// server/storage/meal-plans.ts — getPopularPicksByMealType
const rows = await db
  .select({
    title: mealPlanRecipes.title,
    // ... other fields
    pickCount: sql<number>`count(distinct ${mealPlanRecipes.userId})`.as(
      "pick_count",
    ),
  })
  .from(mealPlanItems)
  .innerJoin(mealPlanRecipes, eq(mealPlanItems.recipeId, mealPlanRecipes.id))
  .where(
    and(
      eq(mealPlanItems.mealType, mealType),
      eq(mealPlanRecipes.sourceType, "ai_suggestion"),
      ne(mealPlanRecipes.userId, userId), // self-exclusion
    ),
  )
  .groupBy(mealPlanRecipes.title /* ... */)
  .orderBy(sql`count(distinct ${mealPlanRecipes.userId}) DESC`)
  .limit(limit);
```

```typescript
// server/routes/meal-suggestions.ts — deduplication before response
const suggestionTitles = new Set(suggestions.map((s) => s.title.toLowerCase()));
return picks.filter((p) => !suggestionTitles.has(p.title.toLowerCase()));
```

## Key elements

1. **Self-exclusion** — `ne(table.userId, currentUserId)` so users don't see their own picks reflected back
2. **Distinct user count** — `count(distinct userId)` measures adoption breadth, not one power-user's repetition
3. **Server-side deduplication** — filter out aggregated results that overlap with the primary response (e.g., AI suggestions) using case-insensitive title matching before sending to the client

## When to use

Any feature that surfaces aggregated behavior from other users — popular items, trending content, "users also picked" recommendations.

## Exceptions

Per-user analytics (e.g., "your most-used recipes") where self-inclusion is the point.

## Related Files

- `server/storage/meal-plans.ts` — `getPopularPicksByMealType()`
- `server/routes/meal-suggestions.ts` — `fetchDeduplicatedPopularPicks()`

## See Also

- [Cross-user product-level queries](cross-user-product-level-queries-2026-05-13.md)
