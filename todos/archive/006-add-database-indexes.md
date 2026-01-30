---
title: "Add database indexes for frequently queried columns"
status: complete
priority: high
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [performance, database, code-review]
---

# Add Database Indexes

## Summary

Several frequently-queried columns lack indexes, causing full table scans that will degrade performance as data grows.

## Background

Current queries filter by `userId` and date ranges but no indexes exist on these columns. As users accumulate scanned items (potentially thousands), queries will slow significantly.

**Missing indexes on:**
- `scannedItems.userId` (shared/schema.ts:65)
- `scannedItems.scannedAt` (shared/schema.ts:80)
- `dailyLogs.userId` (shared/schema.ts:87)
- `dailyLogs.loggedAt` (shared/schema.ts:95)

**Impact at scale:**
- User with 10,000 items: `getScannedItems` returns ~1MB+ data
- `getDailySummary` aggregate performs join with date range filtering

## Acceptance Criteria

- [ ] Add index on `scannedItems.userId`
- [ ] Add index on `scannedItems.scannedAt`
- [ ] Add index on `dailyLogs.userId`
- [ ] Add index on `dailyLogs.loggedAt`
- [ ] Consider composite index on (userId, scannedAt) for scannedItems
- [ ] Run migration with `npm run db:push`

## Implementation Notes

```typescript
// In shared/schema.ts
import { index } from "drizzle-orm/pg-core";

// Add after table definitions:
export const scannedItemsUserIdIdx = index("scanned_items_user_id_idx")
  .on(scannedItems.userId);
export const scannedItemsScannedAtIdx = index("scanned_items_scanned_at_idx")
  .on(scannedItems.scannedAt);
export const dailyLogsUserIdIdx = index("daily_logs_user_id_idx")
  .on(dailyLogs.userId);
export const dailyLogsLoggedAtIdx = index("daily_logs_logged_at_idx")
  .on(dailyLogs.loggedAt);
```

## Dependencies

- None

## Risks

- Index creation on large tables may lock briefly
- Minor increase in storage and write overhead

## Updates

### 2026-01-30
- Initial creation from code review
