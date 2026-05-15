---
title: "Merge two verification stats GROUP BY queries into one"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [performance, audit-2026-03-27-full]
audit_id: M13
---

# Merge two verification stats GROUP BY queries into one

## Summary

`server/storage/verification.ts:83-112` fires two separate GROUP BY queries against the same table for back-label and front-label dates. Could be a single query with conditional aggregation.

## Acceptance Criteria

- [ ] Single query replaces the two separate queries
- [ ] Same results returned
- [ ] Existing tests pass

## Implementation Notes

- Use conditional aggregation: `CASE WHEN front_label_scanned_at IS NOT NULL THEN ... END`

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding M13
