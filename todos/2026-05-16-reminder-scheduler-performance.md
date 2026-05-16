---
title: "Batch reminder scheduler per-user work"
status: backlog
priority: medium
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, performance, database]
github_issue:
---

# Batch Reminder Scheduler Per-User Work

## Summary

Audit finding M2 found the reminder scheduler still serially awaits multiple DB calls per user inside each page. Batch or parallelize the remaining per-user work while preserving duplicate-reminder safety.

## Background

`notification-scheduler.ts` already batch-fetches profiles per page, but daily-checkin and meal-log reminder loops still await pending checks, summaries/logs, and inserts one user at a time. At 500 users per page this creates unnecessary latency and DB round trips.

## Acceptance Criteria

- [ ] Replace serial per-user awaits with bounded parallelism or storage-level batch helpers.
- [ ] Preserve idempotency and duplicate-reminder protection.
- [ ] Keep per-user failures isolated and logged with user context.
- [ ] Add or update tests for muted users, already-pending reminders, and users needing reminders.

## Implementation Notes

Relevant files:

- `server/services/notification-scheduler.ts`
- Related reminder storage helpers under `server/storage/`
- Existing scheduler tests, if present

Prefer bounded concurrency or batch storage helpers over unbounded `Promise.all` if page size remains 500.

## Dependencies

- None known.

## Risks

- Incorrect parallelization could create duplicate reminders.
- Batch helper changes may cross storage boundaries and need broader tests.

## Updates

### 2026-05-16

- Created from broad-sweep audit finding M2.
