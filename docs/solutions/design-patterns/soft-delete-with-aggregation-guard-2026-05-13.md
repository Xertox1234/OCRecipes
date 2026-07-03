---
title: Soft delete with aggregation guard
track: knowledge
category: design-patterns
module: server
tags: [database, soft-delete, aggregation, drizzle, sql, joins]
applies_to: [server/storage/**/*.ts, shared/schema.ts]
created: '2026-05-13'
---

# Soft delete with aggregation guard

## When this applies

When implementing soft delete (setting a `discardedAt` timestamp instead of removing rows), every query that reads from or joins against the soft-deleted table must explicitly exclude discarded rows. This is especially dangerous for aggregation queries through nullable foreign keys, because they return plausible-looking numbers rather than obviously wrong results.

## Examples

Compound WHERE for LEFT JOIN + soft delete:

```typescript
// Simple filter would also exclude rows where the FK itself is NULL:
//   where(isNull(scannedItems.discardedAt))  // WRONG: drops meal plan rows too
// Correct: exclude discarded items but keep null-FK rows
sql`(${scannedItems.discardedAt} IS NULL OR ${dailyLogs.scannedItemId} IS NULL)`;
```

## Why

1. **Every query must add `isNull(discardedAt)`** — missing this in list queries shows "deleted" items; missing it in aggregations inflates totals
2. **LEFT JOIN + soft delete needs a compound WHERE** — `discardedAt IS NULL` alone also excludes rows where the FK is NULL (not discarded, just unlinked). Use `(discardedAt IS NULL OR FK IS NULL)`.
3. **Related features must respect soft delete** — e.g., favouriting a discarded item should return 404

## Related Files

- `shared/schema.ts:119` — `discardedAt` column on `scannedItems`
- `server/storage/nutrition.ts:125` — `softDeleteScannedItem()`
- `server/storage/nutrition.ts:249` — `getDailySummary()` with compound WHERE
- Related learning: "Soft Delete Breaks Aggregation Queries Silently" in LEARNINGS.md

## See Also

- [LEFT JOIN with COALESCE for nullable foreign keys](left-join-with-coalesce-nullable-fks-2026-05-13.md)
