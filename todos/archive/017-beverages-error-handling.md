---
title: "Fix inconsistent error handling in beverages route"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [architecture, audit-2026-03-27-full]
audit_id: M11
---

# Fix inconsistent error handling in beverages route

## Summary

`server/routes/beverages.ts:158-163` re-throws non-Zod errors to Express's global handler instead of using `sendError(res, 500, ...)` like every other route.

## Acceptance Criteria

- [ ] Catch block uses `sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR)` instead of `throw error`
- [ ] Existing tests pass

## Implementation Notes

- Simple one-line change in the catch block

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding M11
