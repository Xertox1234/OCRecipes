---
title: "getDayBounds should use UTC, not local time"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, audit-2026-03-27-full]
audit_id: M5
---

# getDayBounds should use UTC, not local time

## Summary

`server/storage/helpers.ts:14-17` uses `setHours(0,0,0,0)` which operates in the server's local timezone. Daily limits, summaries, and nutrition tracking depend on this function.

## Background

If production runs in UTC but dev runs in local time, daily boundaries differ. This affects all daily limit enforcement and nutrition tracking accuracy.

## Acceptance Criteria

- [ ] `getDayBounds` uses UTC methods (`setUTCHours`) or explicit timezone handling
- [ ] All callers produce correct results regardless of server timezone
- [ ] Existing tests pass (may need timezone-aware test updates)

## Implementation Notes

- Replace `setHours(0,0,0,0)` with `setUTCHours(0,0,0,0)` and `setHours(23,59,59,999)` with `setUTCHours(23,59,59,999)`
- Verify `getMonthBounds` in the same file has the same issue

## Dependencies

- Related to M4 (timestamp timezone consistency)

## Risks

- Changing timezone behavior may shift daily boundaries for existing users — need to verify DB timestamps are also in UTC

## Updates

### 2026-03-27

- Created from full audit finding M5
