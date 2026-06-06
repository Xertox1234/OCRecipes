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

- [ ] Decide: drop `adaptiveGoalsEnabled` + `lastGoalAdjustmentAt` from `shared/schema.ts` (and the update allowlist in `server/storage/users.ts`, the export in `server/storage/export.ts`, and the factory default in `server/__tests__/factories/user.ts`).
- [ ] Decide on GLP-1: either (a) remove `glp1Mode`/`glp1Medication`/`glp1StartDate` + the coach-context-builder branch that reads them, or (b) keep the coach's GLP-1 awareness as an intentional retained behavior — and document which.
- [ ] If dropping columns: `npm run db:push` against the dev DB; verify no remaining references via grep.

## Implementation Notes

- No prod DB — column drops are safe (stateless Drizzle `push`).
- The `lastGoalAdjustmentAt`/`adaptiveGoalsEnabled` references are at: `shared/schema.ts`, `server/storage/users.ts`, `server/storage/export.ts`, `server/__tests__/factories/user.ts`.
- The GLP-1 columns are read in `server/services/coach-context-builder.ts` (and mocked in its tests + `carousel-builder.test.ts`).

## Dependencies

- None (PR #384 merged).

## Risks

- The GLP-1 decision is product-facing — confirm intent before stripping coach behavior.

## Updates

### 2026-06-06

- Initial creation — deferred from #384 (boundary held `users` columns; this is the cleanup pass).
