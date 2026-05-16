---
title: "Fix inconsistent timestamp timezone handling"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, database, audit-2026-03-27-full]
audit_id: M4
---

# Fix inconsistent timestamp timezone handling

## Summary

`shared/schema.ts:305` — `savedItems.createdAt` is the only column using `{ withTimezone: true }`. All other 30+ timestamp columns use `timestamp()` without timezone. This inconsistency can cause incorrect cross-table date comparisons.

## Acceptance Criteria

- [ ] All timestamp columns use the same timezone strategy (either all `withTimezone: true` or all without)
- [ ] Migration handles existing data correctly
- [ ] Existing tests pass

## Implementation Notes

- Preferred: make all timestamps use `withTimezone: true` for UTC-aware storage
- Requires a migration to alter column types — `ALTER TABLE ... ALTER COLUMN ... TYPE timestamptz`
- This is a larger change; alternatively, just fix `savedItems.createdAt` to match the rest (remove `withTimezone`)

## Dependencies

- None

## Risks

- Migration on production data needs careful handling
- Changing column types may affect existing queries

## Updates

### 2026-03-27

- Created from full audit finding M4
