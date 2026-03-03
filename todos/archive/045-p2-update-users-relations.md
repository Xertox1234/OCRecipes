---
title: "P2: Add meal plan tables to usersRelations in schema"
status: backlog
priority: medium
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [schema, p2, meal-plan]
---

# P2: Add meal plan tables to usersRelations in schema

## Summary

The `usersRelations` definition in `shared/schema.ts` was not updated to include `mealPlanRecipes` or `mealPlanItems`, making Drizzle's relational query API incomplete.

## Background

`shared/schema.ts:263-271` — `usersRelations` includes `scannedItems`, `dailyLogs`, `savedItems`, and `profile` but not the new meal plan tables. While current storage methods use explicit queries, the relational API would fail if used.

## Acceptance Criteria

- [ ] Add `mealPlanRecipes: many(mealPlanRecipes)` to `usersRelations`
- [ ] Add `mealPlanItems: many(mealPlanItems)` to `usersRelations`
- [ ] No regressions on tests

## Implementation Notes

Two-line addition to the `usersRelations` definition.

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
