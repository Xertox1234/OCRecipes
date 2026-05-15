---
title: "Remove dead isValidCalendarDate re-export from routes.ts"
status: backlog
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [architecture, audit-2026-03-27-full]
audit_id: L5
---

# Remove dead isValidCalendarDate re-export from routes.ts

## Summary

`server/routes.ts:38` re-exports `isValidCalendarDate` but no consumer uses it. Dead code.

## Acceptance Criteria

- [ ] Import and re-export of `isValidCalendarDate` removed from `server/routes.ts`
- [ ] Existing tests pass, types pass

## Implementation Notes

- One-line deletion

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding L5
