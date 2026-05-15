---
title: "Wrap weight log + user weight update in transaction"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, audit-2026-03-27-full]
audit_id: M3
---

# Wrap weight log + user weight update in transaction

## Summary

`server/routes/weight.ts:114-124` creates a weight log and updates the user's current weight as separate operations. Partial update risk.

## Acceptance Criteria

- [ ] `createWeightLog` and `updateUser` wrapped in `db.transaction()`
- [ ] Existing tests pass

## Implementation Notes

- Straightforward transaction wrapper

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding M3
