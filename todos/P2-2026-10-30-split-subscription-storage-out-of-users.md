---
title: "Split subscription storage out of server/storage/users.ts"
status: backlog
priority: medium
created: 2026-10-30
updated: 2026-11-04
assignee:
labels: [deferred, maintainability]
github_issue:
---

# Split subscription storage out of server/storage/users.ts

## Summary

`server/storage/users.ts` (~1066 lines) was already over the 600-line bar
before the 2026-10-30 reliability audit (iap-auth PR), and that PR grew it.
Move the subscription/transaction functions into their own module.

## Background

The iap-auth code review flagged the file. The review repair extracted the
duplicated renewal write into `applyRenewalInTx`, which removes the drift risk
but does not bring the file under the bar. A real split is a pre-existing
structural problem, out of scope for a reliability-fix PR.

The `client/hooks/useAuth.ts` half of the original todo was split off on
2026-11-04 into `todos/P3-2026-11-04-shrink-useauth-below-600-lines.md`
(human-led: client sign-in code is never delegated).

## Acceptance Criteria

- [ ] The subscription/transaction functions (`createTransaction`,
      `claimTransactionAndUpgrade`, `extendSubscriptionByTransactionId`,
      `revokeSubscriptionByTransactionId`, `isRevokedForReceipt`,
      `applyRenewalInTx`, related types) live in `server/storage/subscriptions.ts`,
      re-exported/composed through `server/storage/index.ts` with no caller change
- [ ] Existing tests pass unchanged (move tests alongside if needed)

## Implementation Notes

- Pure move/refactor; no behaviour change. Transaction boundaries
  (`db.transaction` callers and the `tx` passed into `applyRenewalInTx`) stay
  exactly as they are.
- Files: `server/storage/users.ts`, `server/storage/subscriptions.ts` (new),
  `server/storage/index.ts`, `server/storage/__tests__/users.test.ts` (and a new
  `server/storage/__tests__/subscriptions.test.ts` if tests move).
- Do NOT touch `client/hooks/useAuth.ts` — that is the separate human-led todo.

## Scope Contract

- **Mechanisms to use:** move functions and types; re-export through
  `server/storage/index.ts`.
- **Files in scope:** the files listed above. Nothing under `client/`,
  `server/routes/` or `server/services/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-30

- Initial creation (deferred from the iap-auth reliability PR review)

### 2026-11-04

- Owner ruling: split the todo in two. This storage move stays automatable but
  is raised to medium (renamed from P3) so its PR waits for owner review instead
  of auto-merging — it moves IAP transaction code. The useAuth.ts half moved to
  `todos/P3-2026-11-04-shrink-useauth-below-600-lines.md`, human-led.
