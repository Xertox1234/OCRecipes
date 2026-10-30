---
title: node-cron fires in the host's timezone by default, and noOverlap only works if the handler returns its promise
track: bug
category: logic-errors
module: server
severity: medium
tags: [architecture, cron, node-cron, scheduler, timezone, notifications, reliability]
applies_to: [server/services/notification-scheduler.ts, server/services/**/*scheduler*.ts, server/index.ts]
symptoms: [A cron job fires at a different wall-clock time after a deploy-host change, '"Nothing logged today" nudge arrives at 4am for users far from the server timezone', A slow run overlaps the next tick even though noOverlap is set, Daily reminders reach every user at the same UTC instant instead of their local hour]
created: 2026-10-30
---

# node-cron fires in the host's timezone by default, and noOverlap only works if the handler returns its promise

## Problem

`startNotificationScheduler` called `cron.schedule("0 9 * * *", handler)` and `cron.schedule("0 12 * * *", handler)` without options. That caused three bugs:

1. **Host-TZ firing.** Without `timezone`, node-cron matches the expression against the process's local time. "09:00" meant 09:00 wherever the box was deployed, and the comments that said UTC were wrong.
2. **No overlap protection.** Each handler ran `sendX().catch(...)` and threw the promise away (a block body with no `return`). Even with `noOverlap: true`, node-cron gets `undefined` back, treats the run as finished immediately, and lets the next tick start while the previous run is still working.
3. **Same instant for everyone.** One fixed-hour job for all users delivered the daily check-in and the "nothing logged yet today" nudge at the server's 9am/12pm, which is the middle of the night for users in other timezones.

## Root Cause

node-cron v4 defaults `timezone` to the host's local timezone, and `noOverlap` decides a run is done when the handler's return value settles. Code that worked on a UTC dev box therefore depended on the deploy host, and an arrow function with a block body silently disables `noOverlap`.

## Solution

```ts
// Expression body: the handler RETURNS the promise, so noOverlap can await it.
cron.schedule(
  "0 9 * * *",
  () => sendDueCommitmentReminders().catch((err) => logger.error({ err }, "...")),
  { timezone: "UTC", noOverlap: true, name: "commitment-reminders" },
);
```

For per-user local-time delivery (R31), run **hourly in UTC** and filter each page to the users whose local hour matches the target:

- `civilHourInTz(now, parseTimezone(tzMap.get(id))) === localHour`. NULL or invalid timezones fall back to UTC.
- Fetch timezones **before** profiles, so the per-user profile batch only covers users who are due this hour (about 1/24 of the table, not all of it).
- Capture `now` once per tick and pass it to every query (`getDailySummary(userId, now, tz)`), so a run that spans an hour boundary uses one consistent instant.
- Keep the options optional (`{ now, localHour }`). With no `localHour`, every user is processed, which is the manual/test path.
- Repeat ticks are already idempotent through `pending_reminders_user_type_day_idx` (`onConflictDoNothing`).

## Prevention

- Every `cron.schedule` call passes `{ timezone: "UTC", noOverlap: true, name }`, and its handler is an expression-bodied arrow that returns the promise (or uses `return Promise.all([...])`). `server/index.ts`'s retention job sets `timezone` but not `noOverlap`, which is acceptable for a daily 03:00 job, but follow the full form in new code.
- `noOverlap` only protects a single process. It does not prevent duplicate sends when several instances run. That needs a durable per-run claim, filed as `todos/P2-2026-10-30-scheduler-multi-instance-run-claim.md`.
- A user-facing "daily at HH:00" job is a per-user local-time requirement. Use the hourly-plus-local-hour filter, not a fixed UTC hour.
- Hourly per-user dispatch changes producer cadence. Re-check `docs/solutions/conventions/tz-local-dedup-to-utc-day-index-safe-only-once-per-day-2026-06-26.md` (see its 2026-10-30 update).

## Related Files

- `server/services/notification-scheduler.ts` — `startNotificationScheduler`, `filterByLocalHour`, `LocalHourReminderOptions`, `DAILY_CHECKIN_LOCAL_HOUR` / `MEAL_LOG_LOCAL_HOUR`
- `server/lib/civil-date.ts` — `civilHourInTz`
- `server/services/__tests__/notification-scheduler.test.ts`

## See Also

- `docs/solutions/conventions/tz-local-dedup-to-utc-day-index-safe-only-once-per-day-2026-06-26.md`
- 2026-10-30 reliability audit N5 + R31
