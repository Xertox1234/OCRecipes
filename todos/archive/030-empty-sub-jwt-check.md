---
title: "Reject empty string sub in isAccessTokenPayload"
status: backlog
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [security, audit-2026-03-27-full]
audit_id: L10
---

# Reject empty string sub in isAccessTokenPayload

## Summary

`shared/types/auth.ts:16` accepts empty string as valid `sub` in the JWT type guard. An empty `sub` would result in `req.userId = ""`.

## Acceptance Criteria

- [ ] `payload.sub.length > 0` added to the `isAccessTokenPayload` check
- [ ] Test updated (currently expects `true` for empty string)
- [ ] Existing tests pass

## Implementation Notes

- One-line change + test update

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding L10
