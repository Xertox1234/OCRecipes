---
title: "Drop orphaned adaptive-goals columns (adaptiveGoalsEnabled, lastGoalAdjustmentAt)"
status: done
priority: low
created: 2026-06-09
updated: 2026-06-09
assignee:
labels: [deferred, data-integrity, database]
github_issue:
---

# Drop orphaned adaptive-goals columns

## Summary

Two `users` columns — `adaptiveGoalsEnabled` and `lastGoalAdjustmentAt` — survived the PR #384
adaptive-goals/health-feature removal but are now dead: nothing writes or reads them except the
GDPR export passthrough. Drop them via a Drizzle migration once null-data is confirmed safe.

## Background

Surfaced by the 2026-06-09 cleanup audit (finding L6, deferred at triage). PR #384 removed the
adaptive-goals feature but left these two columns wired into two passive surfaces. They are not a
code-only deletion — removing them needs a schema migration, so it was scoped out of the cleanup
session (which only removed pure code-level dead code). `goalsCalculatedAt` is NOT in scope — it is
still actively written by `server/routes/goals.ts`.

## Acceptance Criteria

- [x] Confirm zero production code writes or reads either column (re-verify with LSP `findReferences` — they should appear only in the 3 sites below).
- [x] Null-data check: query the prod/dev DB for any rows where `adaptive_goals_enabled IS NOT false` OR `last_goal_adjustment_at IS NOT NULL`; document the count before dropping.
- [x] Remove `adaptiveGoalsEnabled` and `lastGoalAdjustmentAt` from `shared/schema.ts` (the `users` table).
- [x] Remove both from the `UpdatableUserFields` union in `server/storage/users.ts`.
- [x] Remove both from the GDPR `exportUserColumns` map in `server/storage/export.ts`.
- [x] Generate/apply the Drizzle migration that `DROP COLUMN`s `adaptive_goals_enabled` and `last_goal_adjustment_at`.
- [x] `npm run check:types` clean; relevant storage/export tests pass; GDPR export still succeeds without the two fields.

## Implementation Notes

Exact current references (all three per column — nothing else):

- `shared/schema.ts` — `adaptive_goals_enabled` boolean (`.default(false)`) and `last_goal_adjustment_at` timestamp column defs on the `users` table.
- `server/storage/users.ts` — both names in the `UpdatableUserFields` union (the field allowlist).
- `server/storage/export.ts` — both in the `exportUserColumns` map (GDPR export passthrough).

Drizzle is stateless `push` in dev (see project memory `reference_dev_db_access`), so a manual
`ALTER TABLE users DROP COLUMN ...` against dev is compatible. Verify the prod migration path
(Railway DB exists) before applying there.

## Dependencies

- None blocking. Independent of other todos.

## Risks

- **Schema migration on a live prod DB** — `DROP COLUMN` is irreversible. Run the null-data check first and confirm no consumer was missed (LSP, not grep). Coordinate the migration with a deploy window.
- The GDPR export shape changes (two fewer fields). Confirm no downstream consumer of the export payload depends on those keys.

## Updates

### 2026-06-09

- Created from cleanup audit finding L6 (deferred at triage; user chose P3).

### 2026-06-10

- Implemented. Reference sweep found 4 code sites (not 3 — `server/__tests__/factories/user.ts` factory defaults were also wired); all removed. LSP was non-functional in the executor worktree, so verification used an exhaustive all-file-type sweep (camelCase + snake_case), independently confirmed by the researcher.
- Null-data check (dev DB, 4853 users): 0 rows with `adaptive_goals_enabled` ≠ false, 0 rows with non-NULL `last_goal_adjustment_at`.
- Migration `migrations/0007_drop_adaptive_goals_columns.sql` (`DROP COLUMN IF EXISTS`) applied to dev. PROD NOT YET APPLIED — Railway CLI unlinked in this session; apply at a deploy window AFTER the new bundle deploys (ordering note in the migration header).
- Also updated `docs/DATABASE.md` and superseded the duplicate AC in `todos/P3-2026-06-06-drop-dead-health-user-columns.md`.
