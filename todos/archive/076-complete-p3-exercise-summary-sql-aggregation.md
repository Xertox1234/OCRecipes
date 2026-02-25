---
title: "Use SQL aggregation in getExerciseDailySummary instead of JS reduce"
status: pending
priority: p3
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, performance]
---

# Use SQL aggregation in getExerciseDailySummary instead of JS reduce

## Summary

`getExerciseDailySummary` fetches all exercise log rows then reduces in JavaScript. Should use `SUM`/`COUNT` in SQL to reduce data transfer.

## Background

Found by: performance-oracle (OPT-4)

**File:** `server/storage/activity.ts`, lines 123-150

Called on every chat message and daily summary request. SQL-side aggregation scales better as exercise log count grows.

## Acceptance Criteria

- [ ] Use `COALESCE(SUM(...), 0)` and `COUNT(*)` in SQL
- [ ] Verify result matches current behavior

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
