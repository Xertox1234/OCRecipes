---
title: "Add composite index on dailyLogs and standardize sendError codes"
status: backlog
priority: medium
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [database, performance, consistency, server]
---

# Database Index & API Consistency Polish

## Summary

Two related polish items: (1) add a composite index on `dailyLogs(userId, loggedAt)` for the most common query pattern, and (2) standardize `sendError()` usage with error codes across all routes.

## Part 1: Composite Index on dailyLogs

### Background

`shared/schema.ts` (lines 152-153) has separate indexes on `userId` and `loggedAt`, but the most common query pattern filters by both (user + date range). PostgreSQL may use an index merge, but a composite index is significantly more efficient.

Additionally, `mealPlanItemId` has no index despite being queried in `getConfirmedMealPlanItemIds`.

### Acceptance Criteria

- [ ] Composite index `(userId, loggedAt)` added to `dailyLogs` (replaces separate `userId` index)
- [ ] Index added on `mealPlanItemId` column
- [ ] `db:push` runs cleanly
- [ ] Query performance validated on daily log listing

## Part 2: Standardize sendError Codes

### Background

Only `nutrition.ts` and `saved-items.ts` pass the optional `code` parameter to `sendError()`. The other 22 route files never use error codes. Clients cannot reliably pattern-match on errors for programmatic handling.

### Acceptance Criteria

- [ ] Error codes defined for common error categories (e.g., `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `PREMIUM_REQUIRED`, `UNAUTHORIZED`)
- [ ] All `sendError()` calls across 24 route files include appropriate error codes
- [ ] Error code constants defined in `shared/constants/` for client/server sharing
- [ ] Existing tests updated to assert error codes where relevant

## Implementation Notes

### Index change
```typescript
// shared/schema.ts — dailyLogs table
(table) => ({
  userLoggedAtIdx: index("daily_logs_user_logged_at_idx").on(table.userId, table.loggedAt),
  loggedAtIdx: index("daily_logs_logged_at_idx").on(table.loggedAt),
  mealPlanItemIdx: index("daily_logs_meal_plan_item_idx").on(table.mealPlanItemId),
}),
```

### Error codes
```typescript
// shared/constants/error-codes.ts
export const ErrorCode = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  PREMIUM_REQUIRED: "PREMIUM_REQUIRED",
  LIMIT_REACHED: "LIMIT_REACHED",
  UNAUTHORIZED: "UNAUTHORIZED",
  CONFLICT: "CONFLICT",
} as const;
```

## Dependencies

- None

## Risks

- Index creation on an existing table with data will lock briefly during migration
- sendError code standardization is a large but mechanical change across 24 files

## Updates

### 2026-02-27
- Initial creation from codebase audit
