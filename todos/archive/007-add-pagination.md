---
title: "Add pagination to getScannedItems query"
status: complete
priority: high
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [performance, api, code-review]
---

# Add Pagination to Scanned Items

## Summary

The `getScannedItems` function returns ALL items for a user without pagination, which will cause API timeouts and memory issues as users accumulate data.

## Background

**Location:** `server/storage.ts:108-114`

```typescript
async getScannedItems(userId: string): Promise<ScannedItem[]> {
  return db
    .select()
    .from(scannedItems)
    .where(eq(scannedItems.userId, userId))
    .orderBy(desc(scannedItems.scannedAt));  // No LIMIT
}
```

**Projected impact:**
- User with 1,000 items: ~100KB+ response
- User with 10,000 items: ~1MB+ response, potential timeout

## Acceptance Criteria

- [x] Add limit and offset parameters to storage function
- [x] Update API endpoint to accept pagination query params
- [x] Implement cursor-based pagination or offset pagination
- [x] Update client to handle paginated responses
- [x] Add total count to response for pagination UI

## Implementation Notes

```typescript
// storage.ts
async getScannedItems(
  userId: string,
  limit = 50,
  offset = 0
): Promise<{ items: ScannedItem[]; total: number }> {
  const [items, [{ count }]] = await Promise.all([
    db.select().from(scannedItems)
      .where(eq(scannedItems.userId, userId))
      .orderBy(desc(scannedItems.scannedAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(scannedItems)
      .where(eq(scannedItems.userId, userId)),
  ]);
  return { items, total: count };
}

// routes.ts
app.get("/api/scanned-items", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const result = await storage.getScannedItems(req.userId!, limit, offset);
  res.json(result);
});
```

## Dependencies

- None

## Risks

- Breaking change for client - needs coordinated update
- FlatList on client needs infinite scroll implementation

## Updates

### 2026-01-30
- Initial creation from code review
- Implemented pagination with offset-based approach:
  - Updated `server/storage.ts`: `getScannedItems()` now accepts `limit` (default 50) and `offset` (default 0) parameters, returns `{ items, total }` using `Promise.all` for parallel count query
  - Updated `server/routes.ts`: GET `/api/scanned-items` now accepts `limit` and `offset` query params with validation (limit max 100, offset min 0)
  - Added `PaginatedScannedItemsResponse` type to `shared/types/models.ts`
  - Updated `client/screens/HistoryScreen.tsx`: Replaced `useQuery` with `useInfiniteQuery` for infinite scroll, added `onEndReached` handler and loading footer
