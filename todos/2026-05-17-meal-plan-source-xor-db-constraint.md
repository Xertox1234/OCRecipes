---
title: "Add DB-level XOR constraint for meal-plan nutrition source"
status: backlog
priority: high
created: 2026-05-17
updated: 2026-05-17
assignee:
labels: [deferred, database, data-integrity, human-plan-required]
github_issue:
---

# Add DB-Level XOR Constraint for Meal-Plan Nutrition Source

## Summary

API-level XOR validation now rejects meal-plan items carrying both `recipeId` and
`scannedItemId`. The database still permits both columns to be populated. Add a
DB-level XOR constraint so direct DB writes and legacy data cannot violate the
invariant.

## Background

Audit finding M6 found meal-plan items can store both `recipeId` and
`scannedItemId`, making nutrition totals depend on `COALESCE` precedence. The
autonomous slice of `2026-05-16-meal-plan-source-xor.md` (archived) added API
validation rejecting two-source requests plus route tests. This follow-up covers
the human-gated database layer: it is split out because schema and migration
changes are hard exclusions requiring a human-approved plan.

## Acceptance Criteria

- [ ] Prepare a human-approved schema/migration plan for a DB-level XOR constraint.
- [ ] After plan approval, add the DB constraint and migration/backfill check.

## Implementation Notes

Relevant files:

- `shared/schema.ts`
- `migrations/**`

Schema and migrations are hard exclusions. Do not edit `shared/schema.ts` or
`migrations/**` without a human-approved plan. The constraint should enforce that
exactly one of `recipeId` / `scannedItemId` is non-null on each meal-plan item
row. A backfill audit is required first: existing rows with both IDs populated
must be reconciled before a CHECK constraint can be applied without failing the
migration.

## Dependencies

- Human-approved schema/migration plan for DB-level enforcement.

## Risks

- Existing rows with both IDs may need cleanup before a DB constraint can be applied.
- A CHECK constraint will fail the migration if any row currently violates it —
  the backfill must run and verify zero violations first.

## Updates

### 2026-05-17

- Split out from `2026-05-16-meal-plan-source-xor.md` after the API-validation
  slice of that todo was completed and archived. This todo carries the remaining
  human-gated DB-constraint acceptance criteria.
