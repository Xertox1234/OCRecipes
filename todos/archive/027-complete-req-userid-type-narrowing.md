---
title: "Type-narrow req.userId after requireAuth to eliminate non-null assertions"
status: backlog
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [architecture, typescript, audit-2026-03-27-full]
audit_id: L7
---

# Type-narrow req.userId after requireAuth to eliminate non-null assertions

## Summary

100+ instances of `req.userId!` across all route files. A typed middleware result or wrapper that narrows the type would eliminate these assertions.

## Acceptance Criteria

- [ ] `requireAuth` middleware narrows `req.userId` to `string` (not `string | undefined`)
- [ ] All `req.userId!` assertions removed
- [ ] Types pass

## Implementation Notes

- Could use a typed request interface: `interface AuthenticatedRequest extends Request { userId: string }`
- Or a wrapper function that narrows the type in the callback

## Dependencies

- None

## Risks

- Large search-and-replace across many files

## Updates

### 2026-03-27

- Created from full audit finding L7
