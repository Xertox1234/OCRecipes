---
title: "P1: Add pagination to recipe list queries"
status: backlog
priority: high
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [performance, p1, meal-plan]
---

# P1: Add pagination to recipe list queries

## Summary

`getUserMealPlanRecipes` and `getUserRecipes` return all records with no LIMIT clause. Power users with hundreds of recipes will produce multi-MB response payloads.

## Background

- `server/storage.ts:737-743` — `getUserMealPlanRecipes` returns ALL recipes for a user, including large text fields (`instructions`, `description`)
- `server/storage.ts:684-690` — `getUserRecipes` (community recipes) has the same issue
- At 500 recipes/user with 10KB text each, payloads exceed 5MB — unacceptable on mobile networks

## Acceptance Criteria

- [ ] Add `limit`/`offset` parameters to `getUserMealPlanRecipes` (default limit: 50)
- [ ] Add `limit`/`offset` parameters to `getUserRecipes` (default limit: 50)
- [ ] Return total count alongside items for client pagination
- [ ] Update corresponding API routes to accept `page`/`limit` query params
- [ ] Update client hooks to support paginated fetching (infinite scroll or pagination)
- [ ] No regressions on tests

## Implementation Notes

Follow the existing `getScannedItems` pagination pattern if one exists. Return `{ items: T[], total: number }`.

## Dependencies

- None

## Risks

- Client screens need UI changes to handle pagination (load more button or infinite scroll)

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
