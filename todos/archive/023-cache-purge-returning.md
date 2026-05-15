---
title: "Eliminate .returning() from cache purge to reduce memory spike"
status: backlog
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [performance, audit-2026-03-27-full]
audit_id: L3
---

# Eliminate .returning() from cache purge to reduce memory spike

## Summary

`server/storage/cache.ts:252-258` uses `.returning({ id: table.id })` on DELETE but only uses `result.length`. This materializes all deleted row IDs unnecessarily.

## Acceptance Criteria

- [ ] `.returning()` removed; use raw SQL `DELETE ... WHERE ...` with `rowCount` or batch deletes with `LIMIT`
- [ ] Existing tests pass

## Implementation Notes

- Drizzle's delete returns the query result which has `rowCount` — use that instead

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding L3
