---
title: Dropping a timezone-local dedup pre-check for a UTC-day unique index preserves behavior only if the producer fires at most once per UTC day
track: knowledge
category: conventions
module: server
tags: [dedup, idempotency, timezone, unique-index, cron, onConflictDoNothing, scheduler, behavior-preservation]
applies_to: [server/services/notification-scheduler.ts, server/services/**/*scheduler*.ts]
created: '2026-06-26'
---

# Dropping a timezone-local dedup pre-check for a UTC-day unique index preserves behavior only if the producer fires at most once per UTC day

## Rule

When you delete an application-level dedup pre-check that bucketed by the **user's local timezone** and rely instead on a **DB unique index bucketed by UTC day** (via `onConflictDoNothing`), the two are equivalent **only if the producer fires at most once per UTC calendar day**. Before deleting the pre-check, confirm the producer's firing cadence (the cron schedule). If it can fire twice in one UTC day, the local-vs-UTC bucket boundary differs and the swap is **not** behavior-preserving.

## Why

The two guards bucket "one per day" differently:

- **Local-tz pre-check:** "already sent today" means today in `America/Los_Angeles` (or the user's tz).
- **UTC-day unique index:** `DATE(sent_at AT TIME ZONE 'UTC')` — one row per user/type per UTC calendar day.

Near a tz offset, a single UTC day spans parts of two local days and vice-versa. If a producer fired **twice** in one UTC day, the local-tz check might allow the second (different local day) while the UTC index would suppress it — a behavioral divergence. The swap is safe precisely when "twice in one UTC day" never happens.

In this codebase the cron fires each producer exactly once per UTC day (commitments + daily-checkin at 09:00 UTC, meal-log at 12:00 UTC), so within any UTC day there is only ever one insert attempt per user — nothing for either guard to dedup against, and the tz-bucket difference is unobservable. That cadence fact — not the index alone — is what makes deleting `hasPendingReminderToday` a zero-behavior-change refactor. The same is true for the new `notification_sends` ledger, whose unique index uses the identical `DATE(sent_at AT TIME ZONE 'UTC')` bucket.

## Examples

`server/services/notification-scheduler.ts` — the three producers dropped their `hasPendingReminderToday(userId, type, tz)` pre-checks and now rely on `notify()` → `createPendingReminder` → `onConflictDoNothing` against `pending_reminders_user_type_day_idx`. The `tz` variable was removed from the commitment producer (it fed only the deleted check) but kept in daily-checkin/meal-log (it still feeds `getDailySummary`/`getDailyLogs` day-bucketing).

When the reviewer flagged the tz-vs-UTC divergence risk, the resolution was to trace the cron cadence and confirm once-per-UTC-day firing — *not* to reinstate the pre-check.

## Exceptions

- If a producer can fire more than once per UTC day (a frequent cron, an on-demand trigger, a retry that re-enters the producer), keep a dedup guard whose bucket matches the intended semantics — and make the index bucket match it (local-day bucketing needs the tz baked into the index expression, which `DATE(... AT TIME ZONE 'UTC')` does not provide).
- If "once per local day" is a real product requirement (not just an implementation detail), a UTC-day index silently changes that contract near tz boundaries even at one fire/day across DST shifts — verify against the requirement, not just the cadence.

## Related Files

- `server/services/notification-scheduler.ts` — producers now rely on the DB unique index
- `shared/schema.ts` — `pending_reminders_user_type_day_idx` and `notification_sends_user_category_day_idx`, both `DATE(... AT TIME ZONE 'UTC')`
- `server/services/notifications/notify.ts` — the facade that performs the idempotent `createPendingReminder`

## See Also

- [Facade-only enforced by a source-grep guard test](../design-patterns/facade-only-enforced-by-source-grep-guard-test-2026-06-26.md) — the facade migration this dedup change was part of
