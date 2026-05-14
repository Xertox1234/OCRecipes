---
title: "Pre-fetched IDs to avoid redundant queries"
track: knowledge
category: design-patterns
tags: [database, performance, routes, storage, optional-parameters]
module: server
applies_to: ["server/routes/**/*.ts", "server/storage/**/*.ts"]
created: 2026-05-13
---

# Pre-fetched IDs to avoid redundant queries

## When this applies

When a route handler needs data that is also needed by a called function, fetch it once and pass it in rather than letting the function query it again.

## Examples

```typescript
// Bad: daily-summary route fetches confirmedIds, then getPlannedNutritionSummary
// fetches them again internally
app.get("/api/daily-summary", requireAuth, async (req, res) => {
  const summary = await storage.getDailySummary(req.userId!, date);
  const confirmedIds = await storage.getConfirmedMealPlanItemIds(req.userId!, date);
  const planned = await storage.getPlannedNutritionSummary(req.userId!, date);
  //                                          ^ internally calls getConfirmedMealPlanItemIds AGAIN
  res.json({ ...summary, ...planned, confirmedMealPlanItemIds: confirmedIds });
});

// Good: Fetch once, pass to dependent function via optional parameter
app.get("/api/daily-summary", requireAuth, async (req, res) => {
  const [summary, confirmedIds] = await Promise.all([
    storage.getDailySummary(req.userId!, date),
    storage.getConfirmedMealPlanItemIds(req.userId!, date),
  ]);
  const planned = await storage.getPlannedNutritionSummary(
    req.userId!, date, confirmedIds, // Pass pre-fetched IDs
  );
  res.json({ ...summary, ...planned, confirmedMealPlanItemIds: confirmedIds });
});

// Storage method accepts optional pre-fetched data
async getPlannedNutritionSummary(
  userId: string,
  date: Date,
  confirmedIds?: number[], // Optional — falls back to internal query
): Promise<PlannedSummary> {
  const excludeIds = confirmedIds ?? (await this.getConfirmedMealPlanItemIds(userId, date));
  // ... use excludeIds
}
```

## When to use

- A route handler and a called function both need the same data
- The data involves a database query that would otherwise run twice
- The function is also called from other contexts where pre-fetching is not available (hence optional parameter)

## Exceptions

- The shared data is trivial to compute (no DB call)
- Only one caller exists — just inline the query

## Related Files

- `server/routes.ts` — daily-summary endpoint
- `server/storage.ts` — `getPlannedNutritionSummary(userId, date, confirmedIds?)`

## See Also

- [Batch fetch with inArray to fix N+1 queries](batch-fetch-with-inarray-fix-n-plus-one-2026-05-13.md)
