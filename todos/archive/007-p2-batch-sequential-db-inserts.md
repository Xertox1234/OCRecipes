---
title: "Batch grocery list inserts and fix sequential DB patterns"
status: backlog
priority: medium
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [performance, database, server]
---

# Batch Sequential DB Inserts

## Summary

Grocery list generation inserts items one at a time in a `for` loop, causing N sequential database round-trips. Convert to batch inserts. Also fix a similar sequential pattern in `getMealPlanItemById`.

## Background

### Grocery list generation (`server/routes/grocery.ts`, lines 131-144)

```typescript
for (const agg of aggregated) {
  const item = await storage.addGroceryListItem({ ... });
  items.push(item);
}
```

For a meal plan with 20 ingredients, this makes 20 sequential DB calls. A batch insert would make 1.

### Meal plan item fetch (`server/storage/meal-plans.ts`, lines 290-315)

`getMealPlanItemById` fetches recipe and scanned item sequentially with two independent queries. These could use `Promise.all()`. The list variant (`getMealPlanItems`) already correctly uses batch fetching.

## Acceptance Criteria

- [ ] `addGroceryListItems` (plural) storage method added for batch insert
- [ ] Grocery generation route uses batch insert instead of loop
- [ ] `getMealPlanItemById` uses `Promise.all()` for independent queries
- [ ] All existing tests pass
- [ ] Verify no regressions in grocery list generation flow

## Implementation Notes

### Batch insert

```typescript
// server/storage/grocery.ts
async addGroceryListItems(items: InsertGroceryListItem[]): Promise<GroceryListItem[]> {
  if (items.length === 0) return [];
  return db.insert(groceryListItems).values(items).returning();
}
```

### Promise.all fix

```typescript
const [recipe, scannedItem] = await Promise.all([
  item.recipeId ? db.query... : null,
  item.scannedItemId ? db.query... : null,
]);
```

## Dependencies

- None

## Risks

- Batch insert changes the return ordering (should match input order in PostgreSQL, but verify)
- Need to handle empty arrays gracefully

## Updates

### 2026-02-27
- Initial creation from codebase audit
