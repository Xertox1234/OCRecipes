---
title: "Guard logAllMutation against duplicate submissions on retry"
status: in-progress
priority: medium
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, data-integrity]
---

# Guard logAllMutation against duplicate submissions on retry

## Summary

`logAllMutation.mutationFn` uses `Promise.all` over N parallel POSTs. If one POST fails, `onError` leaves all items in `parsedItems`. A retry re-submits already-persisted items, creating duplicate `scanned_items` / `daily_logs` rows. There is no DB-level uniqueness guard.

## Background

Deferred from 2026-05-02 full audit (finding M3). The `useQuickLogSession.ts` `logAllMutation` at lines 113-151 does not track which items have already been successfully persisted before the partial failure.

## Acceptance Criteria

- [ ] Retry only re-submits items that were not successfully logged in the previous attempt, OR
- [ ] `onError` clears successfully-logged items from `parsedItems` so retry is idempotent, OR
- [ ] A server-side uniqueness constraint (e.g. on `(userId, productName, createdAt::date)`) prevents exact duplicates

## Implementation Notes

Simplest client fix: on partial failure, track successful indices and remove them from `parsedItems` in `onError`. A proper solution would require the server to return per-item results and the client to diff them.

## Dependencies

- None critical — client-only fix is sufficient for now

## Risks

- DB constraint approach requires a migration and may conflict with legitimate re-logging of the same food the same day

## Updates

### 2026-05-02

- Initial creation (deferred from audit M3)
