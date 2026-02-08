---
title: "P0: Add .notNull() to mealPlanRecipes.userId"
status: backlog
priority: critical
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [data-integrity, p0, meal-plan, schema]
---

# P0: Add .notNull() to mealPlanRecipes.userId

## Summary

The `userId` column on `mealPlanRecipes` is nullable at the database level, allowing orphaned recipes with no owner. Every other user-owned table uses `.notNull()`.

## Background

`shared/schema.ts:405` — the column definition is missing `.notNull()`. The `onDelete: "cascade"` is meaningless for NULL foreign keys. Application code assumes `recipe.userId` is always populated for ownership checks, but the schema doesn't enforce this.

Additionally, `recipe-catalog.ts:223` creates recipes with `userId: ""` (empty string placeholder) that gets overwritten in the route handler — if that overwrite fails, an empty-string userId persists.

## Acceptance Criteria

- [ ] Add `.notNull()` to `mealPlanRecipes.userId` column definition
- [ ] Run `npm run db:push` to verify migration applies cleanly
- [ ] Verify no existing data has null userId (if applicable)
- [ ] No regressions on tests

## Implementation Notes

Single-line change in `shared/schema.ts`:

```typescript
userId: varchar("user_id").notNull().references(() => users.id, {
  onDelete: "cascade",
}),
```

## Dependencies

- None

## Risks

- If any existing rows have null userId, the migration will fail — check data first

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
