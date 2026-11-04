---
title: "Notification scheduler: claim each run so multiple server instances cannot double-send"
status: done
priority: medium
created: 2026-10-30
updated: 2026-10-30
assignee:
labels: [deferred, reliability, server]
github_issue:
---

# Notification scheduler: claim each run so multiple server instances cannot double-send

## Summary

`server/services/notification-scheduler.ts` schedules in-process node-cron jobs. If the
server is ever run as more than one instance, every instance fires the same tick and the
commitment push is sent once per instance (the in-app reminders are already idempotent
via `pending_reminders_user_type_day_idx`, but `recordNotificationSend` still counts once
per instance against the discretionary cap).

## Background

Deferred from the 2026-10-30 reliability audit (finding N5, data-correctness PR). That PR
fixed the in-scope part — every job now passes `{ timezone: "UTC", noOverlap: true, name }`
so firing no longer depends on the host TZ and a slow run cannot be re-entered. The
multi-instance part is latent: the server is single-instance today (see
`docs/superpowers/specs/2026-10-03-password-reset-design.md` "Revisit if the server goes
multi-instance"), and node-cron 4.2.1 has no `distributed` option. A robust fix needs a
durable per-run claim, which is a schema change, so it was deferred rather than bolted on
with a timing-sensitive advisory lock.

## Acceptance Criteria

- [ ] Each scheduler run claims `(job_name, run_slot)` durably (e.g. a `scheduler_runs`
      table with a unique index, `INSERT ... ON CONFLICT DO NOTHING RETURNING`) and skips
      when the claim already exists.
- [ ] Two concurrent invocations of the same run slot send each commitment push once
      (storage test against the real DB).
- [ ] Single-instance behavior is unchanged.

## Implementation Notes

- Files: `server/services/notification-scheduler.ts`, `shared/schema.ts`, a new
  `server/storage/scheduler-runs.ts` (+ `__tests__`).
- A session-level `pg_try_advisory_lock` alone is not enough: with clock skew one
  instance can finish before the other fires and both runs succeed.

## Updates

### 2026-10-30

- Initial creation (reliability audit N5 residual).

### 2026-11-01

- Implemented: `scheduler_runs` table (migration 0035) + `claimSchedulerRun`; both cron jobs claim (job, nearest-UTC-hour slot) before sending. A failed claim skips the run (fails closed).
