---
title: "Decide on now-dead health columns on the users table + coach GLP-1 awareness"
status: backlog
priority: low
created: 2026-06-06
updated: 2026-06-06
assignee:
labels: [deferred, database, ai-prompting]
github_issue:
---

# Decide on now-dead health columns on the users table + coach GLP-1 awareness

## Summary

PR #384 removed the health features but kept their `users`-table columns per an
explicit boundary. Several are now dead or near-dead: decide whether to drop them
and whether the AI coach should retain its residual GLP-1 awareness.

## Background

The #384 boundary was "do not touch `users` columns" (the goal calculator depends
on `weight`/`goalWeight`/`height`/etc.). That correctly preserved the body-metric
columns. But it also left columns that were used _only_ by the removed features:

- `adaptiveGoalsEnabled`, `lastGoalAdjustmentAt` — fully dead (adaptive goals removed).
- `glp1Mode`, `glp1Medication`, `glp1StartDate` — now read only by `coach-context-builder` to tailor GLP-1-aware coaching.

The GLP-1 columns are a product decision, not just cleanup: removing them also means
deciding whether the coach should stop giving GLP-1-tailored advice (consistent with
retiring the GLP-1 companion) or keep that awareness.

## Acceptance Criteria

- [x] ~~Decide: drop `adaptiveGoalsEnabled` + `lastGoalAdjustmentAt`~~ — SUPERSEDED: done by `todos/archive/P3-2026-06-09-drop-adaptive-goals-columns.md` (migration `migrations/0007_drop_adaptive_goals_columns.sql`, 2026-06-10).
- [x] Decide on GLP-1 — **DECIDED 2026-06-20: KEEP (option b).** The coach's
      GLP-1-tailored awareness (`server/services/coach-context-builder.ts` reading
      `glp1Mode`/`glp1Medication`/`glp1StartDate`) is an **intentional retained
      behavior**; the 3 columns stay. No code change.
- [x] ~~If dropping columns: hand-written migration~~ — N/A, columns kept (see above).

## Implementation Notes

- ~~No prod DB~~ STALE (2026-06-10): prod DB now exists on Railway (`api.ocrecipes.com`) — any further column drops need an `IF EXISTS` migration in `migrations/` applied at a deploy window, not blind `db:push` (see `migrations/0007_drop_adaptive_goals_columns.sql` for the pattern).
- The GLP-1 columns are read in `server/services/coach-context-builder.ts` (and mocked in its tests + `carousel-builder.test.ts`).

## Dependencies

- None (PR #384 merged).

## Risks

- The GLP-1 decision is product-facing — confirm intent before stripping coach behavior.

## Updates

### 2026-06-06

- Initial creation — deferred from #384 (boundary held `users` columns; this is the cleanup pass).

### 2026-06-20 (resolved — GLP-1 awareness KEPT; todo closed)

- User decision during a `/todo` run: **keep** the coach's GLP-1 awareness as an
  intentional retained behavior (option b). The `glp1Mode`/`glp1Medication`/
  `glp1StartDate` columns and the `coach-context-builder.ts` branch reading them
  stay. The adaptive-goals columns were already dropped earlier (superseded AC,
  migration `0007`). Nothing left to do — archiving.
