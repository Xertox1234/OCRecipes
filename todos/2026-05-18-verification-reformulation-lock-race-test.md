---
title: "Add concurrent submit-vs-reformulation race regression test"
status: backlog
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, testing, database]
github_issue:
---

# Add Concurrent Submit-vs-Reformulation Race Regression Test

## Summary

`flagReformulation` now takes the same per-barcode `pg_advisory_xact_lock`
as `submitVerification` (PR #219 review fix), serializing the two writers.
There is no test that exercises a concurrent `submitVerification` +
`flagReformulation` on the same barcode to prove the serialization holds.

## Background

PR #219 made verification aggregate updates concurrency-safe and added
`server/storage/__tests__/verification.concurrent.test.ts` covering
submit-vs-submit. The follow-up review (Copilot) found `flagReformulation`
bypassed the advisory lock; that was fixed by adding the lock as the first
statement of its transaction. A kimi WARNING noted the new concurrency
contract has no dedicated regression test.

## Acceptance Criteria

- [ ] Add a multi-connection test (same harness as
      `verification.concurrent.test.ts` — real pool, no savepoint mock) that
      runs `submitVerification` and `flagReformulation` concurrently on one
      barcode and asserts the aggregate ends in a consistent state (no
      lost-update of `verificationCount` / `consensusNutritionData`).
- [ ] Confirm the test fails if the `flagReformulation` advisory lock is
      removed, then passes with it restored.

## Implementation Notes

- Harness: `server/storage/__tests__/verification.concurrent.test.ts` is the
  template — real `server/db` pool, explicit row cleanup in `afterAll`,
  `pool.end()` at the end.
- Both functions lock on `hashtextextended(barcode, 0)`; the test should
  prove ordering is deterministic under the lock regardless of dispatch order.
- Concurrency tests are timing-sensitive — keep the assertion on the final
  committed state, not on interleaving order.

## Dependencies

- Builds on the advisory-lock work in PR #219.

## Risks

- Low. Timing-sensitive tests can flake — assert on end state only.

## Updates

### 2026-05-18

- Created from a kimi WARNING during the PR #219 review-fix commit.
