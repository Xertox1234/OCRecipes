---
title: "Wire user timezone into reminders scheduler (M11 — hasPendingReminderToday still uses UTC)"
status: done
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [reliability, data-integrity, database, deferred]
github_issue:
---

# Reminders scheduler timezone (M11)

## Summary

`hasPendingReminderToday` now accepts a `tz` parameter (added in PR #289) but the reminders scheduler (`server/services/notification-scheduler.ts`) passes no timezone, so it still defaults to UTC — non-UTC users get reminder bucketing on the wrong calendar day.

## Background

From the 2026-05-29 reliability audit (M11). PR #289 fixed the day-bucketing for meal logs, quota, coach cache, and the route-level reminder query, but the batch scheduler was explicitly deferred because it requires fetching all users' timezones from the `users` table before dispatching reminders — a batch read, not a per-request header read.

The `users.timezone` column was added in migration `0006_user_timezone.sql` but has no write path yet — all existing rows are `NULL`, which `hasPendingReminderToday` treats as `"UTC"` (correct fallback). The scheduler fix becomes meaningful only after client-side timezone capture lands (separate concern — the column is populated on first API call once clients send `X-Timezone`).

## Acceptance Criteria

- [ ] Scheduler fetches each user's `timezone` from the `users` table (batch, not per-reminder) before evaluating `hasPendingReminderToday`.
- [ ] `NULL` timezone falls back to `"UTC"` (existing behavior preserved for users who haven't sent `X-Timezone` yet).
- [ ] A scheduled reminder for a user in UTC−7 fires at their local midnight, not server UTC midnight.
- [ ] Unit test: a user with `timezone: "America/Los_Angeles"` gets a pending-reminder result for their local date, not the UTC date.

## Implementation Notes

- File: `server/services/notification-scheduler.ts` — the batch loop that calls `storage.hasPendingReminderToday`.
- Fetch timezones: `storage.getUserTimezones(userIds: string[]): Promise<Map<string, string>>` (new storage helper, or extend the existing user batch fetch).
- The `users.timezone` column is `text` nullable; call `parseTimezone(row.timezone ?? null)` (from `server/routes/_helpers.ts`) to validate and fall back to `"UTC"`.
- Coordinate with the client-side `X-Timezone` write path — once clients send the header, `timezone` gets populated on first API call. Until then, all values are `NULL` → `"UTC"`.

## Dependencies

- `users.timezone` column already exists (migration `0006_user_timezone.sql`, PR #289).
- `hasPendingReminderToday` already accepts `tz` param (PR #289).
- No client changes needed — the scheduler reads timezone from DB, not from a request header.

## Risks

- Batch fetching timezones adds a DB read per scheduler run; use a single `WHERE id = ANY(...)` query over all active user IDs (not N+1).

## Updates

### 2026-05-31

- Created from PR #289 code review (M11 deferred from the reliability audit). Scheduler fix requires batch tz fetch which is beyond a per-request header thread.
- **Done** — PR #295. Added `storage.getUserTimezones` batch helper (no N+1) + threaded `parseTimezone(tz)` into all three reminder paths (commitment, daily-checkin, meal-log). NULL → "UTC". 76/76 affected tests pass, tsc clean, kimi-review clean. (Executor completed the work but crashed on a socket drop pre-commit; orchestrator finalized the verified diff.)
