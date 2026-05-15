---
title: "Add UNIQUE constraint to prevent duplicate pending reminders"
status: done
priority: medium
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, data-integrity]
---

# Add UNIQUE constraint to prevent duplicate pending reminders

## Summary

`sendDue*Reminders` functions in `notification-scheduler.ts` use a check-then-insert pattern across two separate queries with no `UNIQUE` constraint. Concurrent scheduler runs can insert duplicate pending reminders.

## Background

Deferred from 2026-05-02 full audit (finding M4). The pattern at lines 83-97, 179-192, and 242-253 first checks for an existing reminder, then inserts if absent. Under concurrent execution (e.g. two scheduler processes or a fast-firing cron), both processes can pass the check before either inserts.

## Acceptance Criteria

- [ ] A DB migration adds `UNIQUE (userId, type, scheduledFor::date)` to the reminders/notifications table, OR
- [ ] The insert uses `onConflictDoNothing()` (Drizzle) to make the insert idempotent

## Implementation Notes

`onConflictDoNothing()` is the simpler fix — no check query needed, just attempt the insert and let the DB enforce uniqueness. Requires a `UNIQUE` index to back it. See `docs/patterns/database.md` for the `onConflictDoNothing` pattern.

## Dependencies

- Requires a Drizzle migration (`npm run db:push` or migration file)

## Risks

- If `scheduledFor` is a timestamp (not date), the unique key needs to be over the date part — verify column type

## Updates

### 2026-05-02

- Initial creation (deferred from audit M4)
