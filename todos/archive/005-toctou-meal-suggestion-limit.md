---
title: "TOCTOU race on meal suggestion daily limit"
status: backlog
priority: high
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, race-condition, audit-2026-03-27-full]
audit_id: H5
---

# TOCTOU race on meal suggestion daily limit

## Summary

`server/routes/meal-suggestions.ts:70-201` checks daily suggestion count then creates the cache entry in separate operations. Concurrent requests can bypass the daily limit.

## Background

Same TOCTOU pattern as H3 and H4.

## Acceptance Criteria

- [ ] Count check and cache creation wrapped in a `db.transaction()`
- [ ] Existing tests pass

## Implementation Notes

- Same transactional pattern as H3/H4

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding H5
