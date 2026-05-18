---
title: "Per-row isMatch computed from pre-transaction state in submitVerification flow"
status: backlog
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, database, data-integrity]
github_issue:
---

# Per-Row isMatch Computed From Pre-Transaction State

## Summary

`server/routes/verification.ts` reads `existingHistory` / `hasUserVerified` and
computes each submission's `isMatch` _before_ the `submitVerification`
transaction. Under a concurrent first-N burst on a brand-new barcode, every
request sees `existing = []`, so all N rows are stored with `isMatch = true`
even when their nutrition values diverge — and the post-insert recompute then
averages those divergent values into consensus.

## Background

Surfaced as a NIT during the PR #219 review (verification aggregate
concurrency). PR #219 fixed the aggregate lost-update race with a
`pg_advisory_xact_lock` + post-insert recompute, but the _per-row_ `isMatch`
decision still depends on state read outside the lock. This is pre-existing
behavior and was explicitly out of PR #219's scope (aggregate lost-update
only).

## Acceptance Criteria

- [ ] Confirm whether the first-N-burst per-row `isMatch` divergence is a real
      data-integrity concern in practice (how often do genuinely divergent
      scans of a brand-new barcode arrive concurrently?).
- [ ] If real, move the `isMatch` comparison inside the advisory-locked
      transaction so each row is compared against committed history.
- [ ] Preserve duplicate-submit idempotency and reformulation detection.

## Implementation Notes

- Primary file: `server/routes/verification.ts` (the `existingHistory` /
  `hasUserVerified` read, ~lines 104-147).
- Related: `server/storage/verification.ts` `submitVerification` already holds
  a `pg_advisory_xact_lock` on the barcode — the comparison could be moved
  inside that lock.
- Be careful: reformulation detection currently reads pre-submit state by
  design; do not fold that into the lock without checking.

## Dependencies

- Builds on the advisory-lock infrastructure added in PR #219.

## Risks

- Low. Narrow edge case (concurrent first-ever submissions of one barcode with
  divergent nutrition). No current run is red.

## Updates

### 2026-05-18

- Created from the PR #219 review NIT (database-specialist).
