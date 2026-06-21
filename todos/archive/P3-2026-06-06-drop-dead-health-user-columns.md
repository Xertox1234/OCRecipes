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
- [x] Decide on GLP-1: either (a) remove `glp1Mode`/`glp1Medication`/`glp1StartDate` + the coach-context-builder branch that reads them, or (b) keep the coach's GLP-1 awareness as an intentional retained behavior — and document which. → **(b) KEEP** (product decision 2026-06-20). Documented in `shared/schema.ts` at the GLP-1 columns.
- [x] If dropping columns: hand-written `IF EXISTS` migration … → **N/A** (not dropping; decision was to keep).

## Implementation Notes

- ~~No prod DB~~ STALE (2026-06-10): prod DB now exists on Railway (`api.ocrecipes.com`) — any further column drops need an `IF EXISTS` migration in `migrations/` applied at a deploy window, not blind `db:push` (see `migrations/0007_drop_adaptive_goals_columns.sql` for the pattern).
- ~~The GLP-1 columns are read in `server/services/coach-context-builder.ts`~~ STALE (2026-06-20): a full `glp1` grep shows the columns are NOT read to tailor coaching anywhere — they are only defined (`shared/schema.ts`) and writable (the profile update whitelist `server/storage/users.ts`). The coach's live GLP-1 awareness is the `medication_glp1` SAFETY pattern in `server/services/coach-intent-classifier.ts` (routes GLP-1/metabolic-med questions to `safety_refusal`), which is column-independent.

## Dependencies

- None (PR #384 merged).

## Risks

- The GLP-1 decision is product-facing — confirm intent before stripping coach behavior.

## Updates

### 2026-06-06

- Initial creation — deferred from #384 (boundary held `users` columns; this is the cleanup pass).

### 2026-06-20 (resolved — GLP-1 KEEP decision)

- User decided (b): **keep** the app's GLP-1 awareness. Recorded as an
  `INTENTIONALLY RETAINED` comment on the GLP-1 columns in `shared/schema.ts`,
  pointing at the live behavior (the `medication_glp1` safety-refusal pattern in
  `coach-intent-classifier.ts`).
- Corrected a stale premise: the columns are NOT read by `coach-context-builder`
  (or anywhere) to tailor coaching — they're write-only profile fields. So
  "keep" cost nothing to code; it just prevents a future dead-column sweep from
  dropping them.
- The adaptiveGoals half was already done (PR/migration 0007). No further DDL.
  Closing this todo.
