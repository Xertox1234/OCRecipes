---
title: "RECEIPT_VALIDATION_STUB should throw in production, not warn"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [security, audit-2026-03-27-full]
audit_id: M1
---

# RECEIPT_VALIDATION_STUB should throw in production, not warn

## Summary

`server/lib/env.ts:84-91` only emits a warning when `RECEIPT_VALIDATION_STUB=true` in production. Should throw to prevent startup.

## Background

The actual `validateReceipt` function does reject in production, but env validation should be the first line of defense. If the receipt-validation logic is ever refactored, the warning-only approach would silently allow auto-approving receipts.

## Acceptance Criteria

- [ ] `RECEIPT_VALIDATION_STUB=true` + `NODE_ENV=production` throws an error instead of warning
- [ ] Existing tests pass (test env uses non-production NODE_ENV)

## Implementation Notes

- Change `warnings.push(...)` to `throw new Error(...)` for this specific combination

## Dependencies

- None

## Risks

- None — production should never have this flag

## Updates

### 2026-03-27

- Created from full audit finding M1
