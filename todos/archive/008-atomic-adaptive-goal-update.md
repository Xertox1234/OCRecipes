---
title: "Wrap adaptive goal update + audit log in transaction"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, audit-2026-03-27-full]
audit_id: M2
---

# Wrap adaptive goal update + audit log in transaction

## Summary

`server/routes/adaptive-goals.ts:70-92` updates user goals and creates an audit log as separate operations. If the log fails, goals change without an audit trail.

## Background

Health-related goal changes should always have an audit trail. The two operations must be atomic.

## Acceptance Criteria

- [ ] `updateUser` and `createGoalAdjustmentLog` wrapped in `db.transaction()`
- [ ] Existing tests pass

## Implementation Notes

- Straightforward transaction wrapper

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding M2
