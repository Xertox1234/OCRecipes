---
title: "Add NOT NULL constraints to foreign key columns"
status: complete
priority: medium
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [data-integrity, database, code-review]
---

# Add NOT NULL Constraints to Foreign Keys

## Summary

Several foreign key columns allow NULL values, permitting orphaned records that belong to no user.

## Background

**Affected columns in `shared/schema.ts`:**

- `scannedItems.userId` (line 65) - allows NULL
- `dailyLogs.userId` (line 87) - allows NULL
- `dailyLogs.scannedItemId` (line 90) - allows NULL

A scanned item or daily log without a user is meaningless. A daily log without a scanned item reference is also invalid.

## Acceptance Criteria

- [ ] Add `.notNull()` to `scannedItems.userId`
- [ ] Add `.notNull()` to `dailyLogs.userId`
- [ ] Add `.notNull()` to `dailyLogs.scannedItemId`
- [ ] Verify no existing NULL values in database
- [ ] Run migration

## Implementation Notes

```typescript
// shared/schema.ts

export const scannedItems = pgTable("scanned_items", {
  // ...
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),  // Add this
  // ...
});

export const dailyLogs = pgTable("daily_logs", {
  // ...
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),  // Add this
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id, { onDelete: "cascade" })
    .notNull(),  // Add this
  // ...
});
```

Before migration, check for existing NULLs:
```sql
SELECT COUNT(*) FROM scanned_items WHERE user_id IS NULL;
SELECT COUNT(*) FROM daily_logs WHERE user_id IS NULL;
SELECT COUNT(*) FROM daily_logs WHERE scanned_item_id IS NULL;
```

## Dependencies

- Clean up any existing NULL values first

## Risks

- Migration will fail if NULL values exist
- Could be breaking if code paths create NULLs (they shouldn't)

## Updates

### 2026-01-30
- Initial creation from code review
