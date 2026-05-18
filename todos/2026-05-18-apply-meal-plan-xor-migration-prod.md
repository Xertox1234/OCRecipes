---
title: "Apply meal-plan source-XOR migration 0005 to production"
status: backlog
priority: medium
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [database, deployment, human-plan-required]
github_issue:
---

# Apply meal-plan source-XOR migration 0005 to production

## Summary

`migrations/0005_meal_plan_items_source_xor.sql` (added by PR #227) has been
applied and verified only on the local dev DB. It must be audited against and
applied to the production database for the DB-level XOR guarantee to actually
hold in production.

## Background

PR #227 replaced the `meal_plan_items_has_source` CHECK (at-least-one) with
`meal_plan_items_source_xor` — `num_nonnulls(recipe_id, scanned_item_id) = 1`
(exactly-one). The local Step 1 audit found 0 two-source rows, so the local
apply was a clean constraint swap. Production may carry pre-validation legacy
rows that the local dev DB never had, so it needs its own audit before the
migration runs.

## Acceptance Criteria

- [ ] Run the Step 1 audit against the production DB:
      `SELECT id, user_id, recipe_id, scanned_item_id FROM meal_plan_items
    WHERE recipe_id IS NOT NULL AND scanned_item_id IS NOT NULL;`
- [ ] If it returns rows, reconcile them first — null `scanned_item_id` on each
      two-source row (`recipe_id` is canonical; see the archived todo
      `2026-05-17-meal-plan-source-xor-db-constraint.md`, Step 2).
- [ ] Apply `migrations/0005_meal_plan_items_source_xor.sql` to production:
      `psql "$PROD_DATABASE_URL" -f migrations/0005_meal_plan_items_source_xor.sql`
- [ ] Confirm `\d meal_plan_items` shows `meal_plan_items_source_xor` and no
      `meal_plan_items_has_source`.

## Implementation Notes

- Gated on PR #227 merging to `main` first.
- The migration's `DO $$ ... RAISE EXCEPTION ... $$` guard makes the apply
  fail-safe: if any two-source row still exists it aborts the transaction
  cleanly rather than half-applying — so a missed reconciliation cannot corrupt
  the table.
- This is a human ops task (production DB access) — it cannot be run by a
  `/todo` executor worktree.

## Dependencies

- PR #227 (`todo/2026-05-17-meal-plan-source-xor-db-constraint`) merged to `main`.

## Risks

- Production may have legacy two-source rows; the `RAISE EXCEPTION` guard
  surfaces this safely rather than silently.

## Updates

### 2026-05-18

- Created as the production follow-up to Todo #1
  (`2026-05-17-meal-plan-source-xor-db-constraint`, completed via PR #227).

## Copilot Delegation

Do NOT delegate — production data handling and schema/migration work are hard
exclusions on the no-delegate list. Human ops task only.
