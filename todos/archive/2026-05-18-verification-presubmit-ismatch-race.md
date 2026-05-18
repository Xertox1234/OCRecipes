---
title: "Per-row isMatch computed from pre-transaction state in submitVerification flow"
status: done
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

- [x] Confirm whether the first-N-burst per-row `isMatch` divergence is a real
      data-integrity concern in practice (how often do genuinely divergent
      scans of a brand-new barcode arrive concurrently?).
- [x] If real, move the `isMatch` comparison inside the advisory-locked
      transaction so each row is compared against committed history.
- [x] Preserve duplicate-submit idempotency and reformulation detection.

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

### 2026-05-18 — Resolved

- AC #1 determination: the first-N-burst per-row `isMatch` divergence is a
  **real but extremely narrow** concern (requires multiple users scanning the
  exact same brand-new barcode within the same ~50ms transaction window AND
  their OCR extractions genuinely diverging beyond 5% tolerance; the system
  self-heals once the first row commits). It was nonetheless worth fixing
  because the fix is a natural extension of the existing under-lock recompute
  (no new lock, no extra query in the common path).
- Moved the `isMatch` comparison inside the `submitVerification`
  advisory-locked transaction. The matching history rows are now read UNDER
  the lock before the insert; `isMatch` is computed from that authoritative
  set. `submitVerification` dropped its caller-supplied `isMatch` parameter
  and now returns `isMatch` on `SubmitVerificationResult`.
- The pure comparison functions (`valuesMatch`, `nutritionMatches`,
  `compareWithVerifications`) moved to `server/lib/verification-consensus.ts`
  so the storage layer can import them without violating the service→storage
  dependency direction (mirrors the `computeConsensus` precedent);
  `server/services/verification-comparison.ts` re-exports them.
- Duplicate-submit idempotency preserved (the `onConflictDoNothing` no-op path
  still returns the unchanged aggregate). Reformulation detection preserved:
  it still reads pre-submit history (`existingHistory`) for `historyForDetection`
  and the route now uses the authoritative `aggregate.isMatch` rather than a
  pre-transaction-derived value.
- Added a concurrent multi-connection regression test (divergent first-N
  burst) asserting exactly one submission matches.
