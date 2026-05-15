---
title: "Extract duplicate isAdmin function to shared utility"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [architecture, audit-2026-03-27-full]
audit_id: M9
---

# Extract duplicate isAdmin function to shared utility

## Summary

`isAdmin` is copy-pasted identically in `server/routes/admin-api-keys.ts:11` and `server/routes/verification.ts:33`.

## Acceptance Criteria

- [ ] Single `isAdmin` function in `server/routes/_helpers.ts` or `server/middleware/admin.ts`
- [ ] Both route files import from the shared location
- [ ] Existing tests pass

## Implementation Notes

- Simple extract-and-import refactor

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding M9
