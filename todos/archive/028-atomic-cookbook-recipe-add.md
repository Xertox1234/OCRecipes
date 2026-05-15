---
title: "Wrap addRecipeToCookbook insert + updatedAt in transaction"
status: backlog
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, audit-2026-03-27-full]
audit_id: L8
---

# Wrap addRecipeToCookbook insert + updatedAt in transaction

## Summary

`server/storage/cookbooks.ts:88-108` inserts into `cookbookRecipes` and updates `cookbooks.updatedAt` as separate queries. Not data loss but `updatedAt` can be stale.

## Acceptance Criteria

- [ ] Both operations wrapped in `db.transaction()`
- [ ] Existing tests pass

## Implementation Notes

- Straightforward transaction wrapper

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding L8
