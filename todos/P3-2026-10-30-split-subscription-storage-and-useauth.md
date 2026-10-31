---
title: "Split subscription storage out of users.ts and shrink useAuth.ts below 600 lines"
status: backlog
priority: low
created: 2026-10-30
updated: 2026-10-30
assignee:
labels: [deferred, maintainability]
github_issue:
---

# Split subscription storage out of users.ts and shrink useAuth.ts below 600 lines

## Summary

`server/storage/users.ts` (~1066 lines) and `client/hooks/useAuth.ts` (~836
lines) were already over the 600-line bar before the 2026-10-30 reliability
audit (iap-auth PR), and that PR grew both. Split them.

## Background

The iap-auth code review flagged both files. The review repair extracted the
duplicated renewal write into `applyRenewalInTx` (users.ts) and the push-token
rotation effect into `client/hooks/usePushTokenRotation.ts`, which removes the
drift risk but does not bring either file under the bar. A real split is a
pre-existing structural problem, out of scope for a reliability-fix PR.

## Acceptance Criteria

- [ ] The subscription/transaction functions (`createTransaction`,
      `claimTransactionAndUpgrade`, `extendSubscriptionByTransactionId`,
      `revokeSubscriptionByTransactionId`, `isRevokedForReceipt`,
      `applyRenewalInTx`, related types) live in `server/storage/subscriptions.ts`,
      re-exported/composed through `server/storage/index.ts` with no caller change
- [ ] `client/hooks/useAuth.ts` is under 600 lines (e.g. extract the cached-session
      restore and the `checkAuth` body into a sibling module/hook)
- [ ] Existing tests pass unchanged (move tests alongside if needed)

## Implementation Notes

- Pure move/refactor; no behaviour change.
- Files: `server/storage/users.ts`, `server/storage/subscriptions.ts` (new),
  `server/storage/index.ts`, `server/storage/__tests__/users.test.ts`,
  `client/hooks/useAuth.ts`, `client/hooks/__tests__/useAuth.test.ts`.

## Updates

### 2026-10-30

- Initial creation (deferred from the iap-auth reliability PR review)
