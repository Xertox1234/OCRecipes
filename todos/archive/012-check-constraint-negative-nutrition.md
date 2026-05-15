---
title: "Add CHECK constraints for non-negative nutrition values"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, database, audit-2026-03-27-full]
audit_id: M6
---

# Add CHECK constraints for non-negative nutrition values

## Summary

`shared/schema.ts:102-108` — `scannedItems` and `mealPlanRecipes` have no CHECK constraints preventing negative values for calories, protein, carbs, fat, etc. `servings` columns also lack non-negative/non-zero checks.

## Acceptance Criteria

- [ ] CHECK constraints added for `calories >= 0`, `protein >= 0`, `carbs >= 0`, `fat >= 0` on `scannedItems`
- [ ] Same for `mealPlanRecipes` nutrition columns
- [ ] CHECK constraint `servings > 0` on `dailyLogs` and `mealPlanItems`
- [ ] Migration handles existing data (verify no negative values exist)
- [ ] Existing tests pass

## Implementation Notes

- Use Drizzle's `check()` constraint in the table definition
- Run a pre-migration query to verify no existing rows violate the constraint

## Dependencies

- None

## Risks

- If existing data has negative values, the migration will fail — need pre-check

## Updates

### 2026-03-27

- Created from full audit finding M6
