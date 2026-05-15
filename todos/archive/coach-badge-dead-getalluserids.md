---
title: "Remove dead getAllUserIds export and its stale test mock"
status: done
priority: medium
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [cleanup, coach-badge, storage, testing]
---

# Remove dead getAllUserIds export and its stale test mock

## Summary

`getAllUserIds` in `server/storage/users.ts` is no longer called by any production code — the notification scheduler was migrated to `getUserIdPage` cursor pagination. The function remains exported from `server/storage/index.ts` and mocked in the scheduler test, both of which are now dead code.

## Background

After the coach-badge cursor-pagination todo (commit `0a93600d`), `getAllUserIds` has no callers outside tests. The stale mock at `server/services/__tests__/notification-scheduler.test.ts:23` creates the false impression the scheduler still uses it.

```ts
// server/storage/index.ts:56 — should be removed
getAllUserIds: users.getAllUserIds,

// notification-scheduler.test.ts:23 — stale mock
getAllUserIds: vi.fn(),
```

## Acceptance Criteria

- [ ] Verify with `grep -rn "getAllUserIds" server/ --include="*.ts"` that no production code calls the function (tests only)
- [ ] Remove `getAllUserIds` from `server/storage/users.ts`
- [ ] Remove `getAllUserIds` re-export from `server/storage/index.ts`
- [ ] Remove `getAllUserIds: vi.fn()` from the scheduler test mock
- [ ] All tests pass after removal

## Implementation Notes

Run `grep -rn "getAllUserIds" server/ --include="*.ts"` first — if any non-test caller appears, stop and investigate before removing.

## Dependencies

- None

## Risks

- Low — dead code removal with grep verification before acting

## Updates

### 2026-05-01

- Identified during code review of coach-badge todo session
