---
title: CASE/WHEN batch update for reordering
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, sql, batch-update, performance, reordering]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# CASE/WHEN batch update for reordering

## When this applies

When updating a sort order or position for multiple rows, use a single `UPDATE ... SET sortOrder = CASE WHEN id = X THEN Y ... END` instead of N sequential UPDATEs. This reduces round-trips from O(N) to O(1).

## Examples

```typescript
// ✅ GOOD: Single UPDATE with CASE expression
export async function reorderMealPlanItems(
  userId: string,
  items: { id: number; sortOrder: number }[],
): Promise<void> {
  if (items.length === 0) return;

  const ids = items.map((i) => i.id);
  const caseFragments = items.map(
    (i) => sql`WHEN ${mealPlanItems.id} = ${i.id} THEN ${i.sortOrder}`,
  );

  await db
    .update(mealPlanItems)
    .set({
      sortOrder: sql`CASE ${sql.join(caseFragments, sql` `)} ELSE ${mealPlanItems.sortOrder} END`,
    })
    .where(
      and(eq(mealPlanItems.userId, userId), inArray(mealPlanItems.id, ids)),
    );
}

// ❌ BAD: N sequential UPDATEs in a transaction — N round-trips to the database
await db.transaction(async (tx) => {
  for (const item of items) {
    await tx
      .update(mealPlanItems)
      .set({ sortOrder: item.sortOrder })
      .where(
        and(eq(mealPlanItems.id, item.id), eq(mealPlanItems.userId, userId)),
      );
  }
});
```

## Key elements

1. **`sql.join(caseFragments, sql\` \`)`** — Drizzle helper to safely join SQL fragments with a separator
2. **`inArray(mealPlanItems.id, ids)`** — limits the UPDATE to only the rows being reordered (+ userId for IDOR protection)
3. **`ELSE ${mealPlanItems.sortOrder} END`** — keeps untouched rows at their current position
4. **Early return on empty** — avoids generating an invalid `CASE END` with no WHEN clauses

## When to use

Any drag-and-drop reorder, bulk priority update, or batch position assignment where the caller sends `{ id, newPosition }[]`.

## Exceptions

Single-row updates, or cases where each row needs different SET columns (not just different values for the same column).

## Related Files

- `server/storage/meal-plans.ts` — `reorderMealPlanItems()`

## See Also

- [Batch UPDATE via UPDATE … FROM (VALUES …)](batch-update-via-update-from-values-2026-05-13.md)
