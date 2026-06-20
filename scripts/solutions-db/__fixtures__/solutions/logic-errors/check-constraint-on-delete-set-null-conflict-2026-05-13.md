---
title: CHECK Constraint vs ON DELETE SET NULL Conflict
track: bug
category: logic-errors
module: server
severity: high
tags: [database, check-constraint, foreign-key, cascade, postgres, gdpr]
symptoms:
  [
    Deleting a parent row fails with CHECK constraint violation,
    User account deletion blocked because the cascade chain hits a CHECK,
    CRUD tests pass; deletion-cascade only fails when parent rows exist,
  ]
applies_to: [shared/schema.ts, server/storage/**/*.ts]
created: "2026-03-29"
---

# CHECK Constraint vs ON DELETE SET NULL Conflict

## Problem

Tables `dailyLogs` and `mealPlanItems` use a CHECK constraint requiring at least one of two nullable FK columns to be non-null (e.g., `CHECK(scannedItemId IS NOT NULL OR mealPlanRecipeId IS NOT NULL)`). The FK columns also had `ON DELETE SET NULL` referential actions. When the referenced parent row is deleted, PostgreSQL fires `ON DELETE SET NULL` first, setting the FK column to `NULL`. The CHECK constraint then evaluates and rejects the mutation because both columns are `NULL`. The parent delete fails — and the failure cascades upward, blocking user account deletion (GDPR concern).

## Symptoms

- `DELETE FROM mealPlanRecipes WHERE id = ?` fails with CHECK violation
- User deletion fails because the cascade chain passes through these tables
- Each constraint is correct in isolation; the conflict is at the interaction point

## Root Cause

`ON DELETE SET NULL` and CHECK constraints are evaluated at different stages of the same statement: SET NULL fires first, then CHECK is evaluated against the post-SET-NULL row. Neither knows about the other. PostgreSQL has no special handling — the row state after SET NULL must satisfy all constraints, and it doesn't.

## Solution

Change the affected FK columns from `ON DELETE SET NULL` to `ON DELETE CASCADE`. When the parent is deleted, the child row is removed entirely rather than having its FK nulled, so the CHECK constraint is never evaluated against a `NULL`-everywhere row:

```sql
ALTER TABLE daily_logs
  DROP CONSTRAINT daily_logs_meal_plan_recipe_id_fkey,
  ADD CONSTRAINT daily_logs_meal_plan_recipe_id_fkey
    FOREIGN KEY (meal_plan_recipe_id)
    REFERENCES meal_plan_recipes(id)
    ON DELETE CASCADE;
```

## Prevention

- When a table has a CHECK constraint involving nullable FK columns, `ON DELETE SET NULL` on those FKs can conflict with the CHECK. Prefer `ON DELETE CASCADE` or `ON DELETE RESTRICT`.
- Always trace the full cascade chain when adding CHECK constraints to tables with FKs — test what happens when each referenced parent is deleted.
- Class of bug is invisible in normal CRUD testing; it only surfaces when a parent row is deleted while child rows reference it. Add a dedicated deletion-cascade test for each table with a multi-FK CHECK.

## Related Files

- `shared/schema.ts` — FK referential actions on `dailyLogs`, `mealPlanItems`
- Audit: 2026-03-29-full H3, H4

## See Also

- [CHECK constraint for mutually-optional FK pairs](../conventions/check-constraint-mutually-optional-fk-pairs-2026-05-13.md)
- [Cascade-aware retention ordering](../conventions/cascade-aware-retention-ordering-2026-05-13.md)
