---
title: Batch fetch with inArray to fix N+1 queries
track: knowledge
category: design-patterns
module: server
tags: [database, performance, drizzle, batch, n-plus-one]
applies_to: [server/storage/**/*.ts, server/routes/**/*.ts]
created: '2026-05-13'
---

# Batch fetch with inArray to fix N+1 queries

## When this applies

When a route handler loops over a list of records and makes individual DB queries or API calls for each one, replace the loop with a single batch query using Drizzle's `inArray` operator. Deduplicate IDs before the batch to avoid redundant work.

## Examples

**Before (N+1 problem):**

```typescript
// Bad: N individual DB queries + N API calls inside a loop
const logs = await storage.getDailyLogs(userId, date);
const results = [];
for (const log of logs) {
  if (!log.scannedItemId) continue;
  const item = await storage.getScannedItem(log.scannedItemId); // N queries
  const nutrients = await lookupMicronutrients(item.productName); // N API calls
  results.push(nutrients);
}
```

**After (batch + deduplicate):**

```typescript
// Good: 1 DB query + M cached API calls (M = unique food names ≤ N)
const logs = await storage.getDailyLogs(userId, date);

// 1. Deduplicate IDs before batch query
const scannedItemIds = [
  ...new Set(
    logs
      .map((log) => log.scannedItemId)
      .filter((id): id is number => id !== null),
  ),
];

// 2. Single batch query with inArray
const items = await storage.getScannedItemsByIds(scannedItemIds, userId);

// 3. Parallel cached lookups for unique food names
const foodNames = items.map((item) => item.productName);
const nutrientArrays = await batchLookupMicronutrients(foodNames);
```

Storage method using `inArray`:

```typescript
async getScannedItemsByIds(
  ids: number[],
  userId?: string,
): Promise<ScannedItem[]> {
  if (ids.length === 0) return [];
  const conditions = [
    inArray(scannedItems.id, ids),
    isNull(scannedItems.discardedAt),
  ];
  if (userId) conditions.push(eq(scannedItems.userId, userId));
  return db
    .select()
    .from(scannedItems)
    .where(and(...conditions));
}
```

## When to use

- Route handlers that iterate over a list and query individually per item
- Any endpoint where you have a list of IDs and need the corresponding records
- Aggregation endpoints that combine data from multiple related records

## Exceptions

- Single-item lookups (just use `eq()`)
- Cases where the list is always exactly 1 item
- When you need different columns per item (batch queries return uniform shape)

## Key elements

1. **Deduplicate with `new Set()`** — IDs from logs may repeat; dedup before the query avoids fetching the same row twice and reduces result set size
2. **Early return for empty array** — `if (ids.length === 0) return []` prevents Drizzle from generating an invalid `IN ()` clause
3. **Optional `userId` for defense-in-depth** — batch methods on user-owned tables should accept optional userId to filter, following the storage-layer IDOR defense-in-depth pattern
4. **Type-narrowing filter** — `.filter((id): id is number => id !== null)` removes nulls and narrows the type in one step

## Related Files

- `server/storage.ts` — `getScannedItemsByIds(ids, userId?)`
- `server/routes/micronutrients.ts` — daily micronutrient endpoint

## See Also

- [Pre-fetched IDs to avoid redundant queries](pre-fetched-ids-avoid-redundant-queries-2026-05-13.md)
- [Storage-layer defense-in-depth for IDOR](../conventions/storage-layer-idor-defense-in-depth-2026-05-13.md)
