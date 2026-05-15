---
title: "Fix startNotificationScheduler idempotency guard to cover both cron jobs"
status: in-progress
priority: high
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [bug, coach-badge, scheduler]
---

# Fix startNotificationScheduler idempotency guard to cover both cron jobs

## Summary

`startNotificationScheduler` guards against double-start by checking only `scheduledTask` (the 09:00 job). If the 12:00 `mealLogTask` ever gets nulled independently, a second call to `start` would create a duplicate meal-log cron without triggering the guard.

## Background

PR #45 added a second cron (`mealLogTask` at 12:00) alongside the existing `scheduledTask` (09:00). The idempotency check was not updated:

```ts
// server/services/notification-scheduler.ts
export function startNotificationScheduler(): void {
  if (scheduledTask) return;   // ← only covers the 09:00 job
  scheduledTask = cron.schedule("0 9 * * *", ...);
  mealLogTask   = cron.schedule("0 12 * * *", ...);
}
```

A future change that stops only `mealLogTask` (or a crash that nulls only that ref) would allow a second 12:00 job to be created on the next `start` call, firing meal-log nudges twice.

## Acceptance Criteria

- [ ] Guard checks both `scheduledTask` and `mealLogTask`
- [ ] Existing scheduler tests still pass
- [ ] Test updated to verify idempotency covers the 12:00 job specifically

## Implementation Notes

```ts
export function startNotificationScheduler(): void {
  if (scheduledTask || mealLogTask) return;
  // ...
}
```

The test `"is idempotent — calling twice creates only two jobs total"` already verifies the count; add an assertion that the count stays at 2 even after multiple calls.

## Dependencies

- None

## Risks

- Low — isolated change to a single guard condition

## Updates

### 2026-05-01

- Identified during PR #45 code review
