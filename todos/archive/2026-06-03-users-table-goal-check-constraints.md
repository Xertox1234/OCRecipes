---
title: "Add >= 0 CHECK constraints on users table daily goal columns"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, data-integrity]
github_issue:
---

# Add >= 0 CHECK constraints on users table daily goal columns

## Summary

`users` table lacks `>= 0` CHECK constraints on `dailyCalorieGoal`, `dailyProteinGoal`, `dailyCarbsGoal`, `dailyFatGoal`. Route Zod guards exist but DB-level defence-in-depth is absent; comparable columns in `goalAdjustmentLogs` and nutrition tables are already constrained.

## Background

Deferred from 2026-06-03 full audit (L4). File: `shared/schema.ts:36-46`. No prod DB yet — this is schema hardening before first deploy.

## Acceptance Criteria

- [ ] All four columns have `.check(sql\`column >= 0\`)` or equivalent Drizzle constraint
- [ ] `npm run db:push` applies cleanly (no-op if columns already have non-negative data)

## Implementation Notes

Use Drizzle `.check()` column modifier or a table-level check constraint. Pattern matches existing constraints in `goalAdjustmentLogs`. Since there's no prod DB yet, no migration risk — just schema + push.

## Dependencies

- No prod DB deployment yet — safe to push at any time

## Risks

- None pre-launch; post-launch would require an ALTER with a constraint add

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L4)
