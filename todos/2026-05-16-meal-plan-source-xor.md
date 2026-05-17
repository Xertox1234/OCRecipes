---
title: "Require exactly one meal-plan nutrition source"
status: backlog
priority: high
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, database, data-integrity, human-plan-required]
github_issue:
---

# Require Exactly One Meal-Plan Nutrition Source

## Summary

Audit finding M6 found meal-plan items can store both `recipeId` and `scannedItemId`, making nutrition totals depend on `COALESCE` precedence. Require exactly one nutrition source at the API and database layers.

## Background

The route and DB constraint currently reject zero-source meal-plan items, but they allow both a recipe and scanned item. Daily nutrition totals use `COALESCE(scannedItems.*, mealPlanRecipes.*)`, so scanned item nutrition silently wins when both are present.

## Acceptance Criteria

- [ ] Add API validation rejecting requests with both `recipeId` and `scannedItemId`.
- [ ] Add tests for zero-source, recipe-only, scanned-item-only, and two-source requests.
- [ ] Prepare a human-approved schema/migration plan for a DB-level XOR constraint.
- [ ] After plan approval, add the DB constraint and migration/backfill check.

## Implementation Notes

Relevant files:

- `server/routes/meal-plan.ts`
- `shared/schema.ts`
- Meal-plan route tests under `server/routes/__tests__/`

Schema and migrations are hard exclusions. Do not edit `shared/schema.ts` or `migrations/**` without a human-approved plan.

## Dependencies

- Human-approved schema/migration plan for DB-level enforcement.

## Risks

- Existing rows with both IDs may need cleanup before a DB constraint can be applied.
- API-only validation fixes new writes but not direct DB writes or legacy data.

## Updates

### 2026-05-16

- Created from broad-sweep audit finding M6.
