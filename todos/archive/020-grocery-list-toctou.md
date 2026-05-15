---
title: "TOCTOU race on grocery list creation at route level"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, race-condition, audit-2026-03-27-full]
audit_id: M14
---

# TOCTOU race on grocery list creation at route level

## Summary

`server/routes/grocery.ts:105-149` checks grocery list count then creates a list as separate operations. The batch path (`batch.ts`) correctly wraps this in a transaction, but the primary route does not.

## Acceptance Criteria

- [ ] Count check and list creation wrapped in `db.transaction()` (matching the batch path pattern)
- [ ] Existing tests pass

## Implementation Notes

- Follow the existing pattern in `batch.ts:124-133`

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding M14
