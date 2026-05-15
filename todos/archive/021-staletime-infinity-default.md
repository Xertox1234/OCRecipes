---
title: "Change global staleTime default from Infinity to 5 minutes"
status: backlog
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [performance, client, audit-2026-03-27-full]
audit_id: L1
---

# Change global staleTime default from Infinity to 5 minutes

## Summary

`client/lib/query-client.ts:110` sets `staleTime: Infinity` globally. Any new hook that forgets to set `staleTime` will show permanently stale data.

## Acceptance Criteria

- [ ] Global default changed to `staleTime: 5 * 60 * 1000` (5 minutes)
- [ ] Hooks that genuinely need infinite staleness (static config) opt in explicitly
- [ ] No behavior change for hooks that already set their own `staleTime`
- [ ] Existing tests pass

## Implementation Notes

- Audit all hooks that rely on the global `Infinity` default to confirm they don't break with 5-minute staleness

## Dependencies

- None

## Risks

- Hooks that depended on `Infinity` default will now refetch after 5 min — may cause unexpected network requests

## Updates

### 2026-03-27

- Created from full audit finding L1
