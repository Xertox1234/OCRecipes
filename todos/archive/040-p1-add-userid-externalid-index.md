---
title: "P1: Add composite index on (userId, externalId) for recipe dedup"
status: backlog
priority: high
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [performance, p1, meal-plan, schema]
---

# P1: Add composite index on (userId, externalId) for recipe dedup

## Summary

The `findMealPlanRecipeByExternalId` query filters on both `userId` and `externalId` but only a `userId` index exists, causing sequential scans for dedup lookups.

## Background

`shared/schema.ts:453-455` — only a `userId` index is defined. `storage.ts:696-709` queries `WHERE userId = ? AND externalId = ?` on every catalog save operation. Without the composite index this degrades as recipe count grows.

## Acceptance Criteria

- [ ] Add composite index `(userId, externalId)` to `mealPlanRecipes` table
- [ ] Run `npm run db:push` to verify migration
- [ ] No regressions on tests

## Implementation Notes

```typescript
(table) => ({
  userIdIdx: index("meal_plan_recipes_user_id_idx").on(table.userId),
  userExternalIdIdx: index("meal_plan_recipes_user_external_id_idx").on(table.userId, table.externalId),
}),
```

Consider making this a UNIQUE index to also solve the race condition in dedup (two concurrent saves could both pass the check-then-insert).

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
