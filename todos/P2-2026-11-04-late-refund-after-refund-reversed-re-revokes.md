---
title: "A refund notification that arrives after its REFUND_REVERSED downgrades the user again"
status: backlog
priority: medium
created: 2026-11-04
updated: 2026-11-04
assignee:
labels: [iap, reliability, deferred-finding]
github_issue:
---

## Problem

Found by the security-auditor pass on PR #1623 at 824317af9 (reasoned from the code, not run).

`reinstateSubscriptionByTransactionId` (Apple `REFUND_REVERSED`, `server/storage/users.ts`) ignores a reversal signed at or before the row's `revokedAt`, so an out-of-order reversal can't undo a later refund. `revokeSubscriptionByTransactionId` has no matching guard.

Sequence: REFUND (revocationDate T1) → REFUND_REVERSED (row back to `completed`, `revokedAt` cleared to NULL) → the same REFUND redelivered or arriving late (Apple retries for about 72 h). The revoke sets `status = 'revoked'`, `revokedAt = LEAST(NULL, T1) = T1` and downgrades the user. After that, `isRevokedForReceipt` refuses the user's own receipt from before T1.

The error goes against the paying user, never toward granting access they shouldn't have, and it is not a regression: before #1623, REFUND_REVERSED reinstated nothing. The app has no users and no live store yet, so nothing is affected today.

## Fix direction

The revoke has to know a reversal already happened for this refund. Options:

- Store the reversal's `signedDate` (a new nullable `transactions.refund_reversed_at`), and skip a revoke whose `revocationDate` is at or before it. This needs a migration applied to production before merge, like 0037.
- Or keep `revokedAt` on reinstate (a `completed` row with `revokedAt` set means "a refund was reversed"), and skip a revoke when the row is not `revoked` and the incoming `revocationDate` is at or before the existing `revokedAt`. Every reader of `revokedAt` (`isRevokedForReceipt`, the reinstate stale check) would need to be re-checked.

## Acceptance

- A real-Postgres test of REFUND(T1) → REFUND_REVERSED → REFUND(T1) redelivered leaves the row `completed` and the user premium.
- A genuinely new refund (a later revocationDate) after a reversal still revokes.
