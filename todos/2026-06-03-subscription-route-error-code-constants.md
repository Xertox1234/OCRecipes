---
title: "Replace ad-hoc string literals in subscription.ts with ErrorCode constants"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, security]
github_issue:
---

# Replace ad-hoc string literals in subscription.ts with ErrorCode constants

## Summary

`subscription.ts` `applyValidatedReceipt` uses ad-hoc string literals `"MISSING_TRANSACTION_ID"` / `"SUBSCRIPTION_ALREADY_LINKED"` instead of `ErrorCode.*` constants — not statically traceable.

## Background

Deferred from 2026-06-03 full audit (L8). File: `server/routes/subscription.ts:65,93`.

## Acceptance Criteria

- [ ] `"MISSING_TRANSACTION_ID"` replaced with the appropriate `ErrorCode` constant
- [ ] `"SUBSCRIPTION_ALREADY_LINKED"` replaced with the appropriate `ErrorCode` constant
- [ ] If the constants don't exist yet, add them to the `ErrorCode` enum/object

## Implementation Notes

Find the `ErrorCode` enum/object definition (likely in `server/lib/` or `shared/`). Add constants if missing. Swap the string literals. Grep for other ad-hoc strings in the same file.

## Dependencies

- None

## Risks

- Low — client error handling should use the constant values already; only change is staticness

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L8)
