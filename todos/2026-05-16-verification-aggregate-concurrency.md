---
title: "Make verification aggregate updates concurrency-safe"
status: backlog
priority: medium
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, database, data-integrity]
github_issue:
---

# Make Verification Aggregate Updates Concurrency-Safe

## Summary

Kimi review during the broad-sweep H1/H2 fix loop surfaced a potential concurrent-update race in `submitVerification`: different users verifying the same barcode concurrently can insert distinct history rows but race on caller-supplied aggregate `verificationCount` / `verificationLevel` updates.

## Background

The H2 fix ensures `barcode_verifications` exists before inserting `verification_history`, preserving duplicate-user idempotency. It does not change the existing aggregate design: callers compute `newLevel`, `newCount`, and `consensusData` before calling `submitVerification`, then the storage function writes those values after a successful history insert. If two users submit at the same time after reading the same pre-submit state, both may write the same aggregate count.

## Acceptance Criteria

- [ ] Reproduce or disprove the concurrent aggregate race with a multi-connection test or a focused storage-level test harness.
- [ ] If real, make aggregate updates concurrency-safe inside the transaction.
- [ ] Preserve same-user duplicate idempotency: duplicate history inserts must not mutate aggregate status.
- [ ] Preserve consensus/reformulation behavior expected by `server/routes/verification.ts`.
- [ ] Add regression tests for concurrent different-user submissions if the harness can support them.

## Implementation Notes

Relevant files:

- `server/storage/verification.ts`
- `server/routes/verification.ts`
- `server/storage/__tests__/verification.test.ts`
- `test/db-test-utils.ts`

Likely approaches include row locking, computing aggregate count from `verification_history` inside the transaction after the insert, or moving more of the route-level aggregate calculation into storage. Be careful: consensus data and reformulation detection currently depend on pre-submit state in the route.

## Dependencies

- May need test-harness support for true multi-connection concurrency.

## Risks

- A naive fix could break duplicate-submit idempotency or reformulation detection.
- Moving aggregate calculation across route/storage boundaries may become broader architecture work.

## Updates

### 2026-05-16

- Created from Kimi WARNING during broad-sweep H1/H2 fix review. Deferred because it is broader than the FK-ordering fix and needs concurrency-focused design/testing.
