---
title: 'pg_terminate_backend by application_name also kills queued lock WAITERS — discriminate holders with a granted-advisory pg_locks predicate'
track: bug
category: logic-errors
tags: [postgres, advisory-lock, pg-terminate-backend, application-name, pg-locks, pg-lab]
module: server
applies_to: ["scripts/pg-lab/**/*.sh"]
symptoms: [A waiter blocked in pg_advisory_lock dies with 'terminating connection due to administrator command' the moment the holder releases, Lock handoff (A releases while B waits) spuriously fails B with a timeout/exit-2 while status shows the lock free, release/force-free tooling reports success but the queued next-in-line never acquires]
created: 2026-07-10
severity: high
---

# pg_terminate_backend by application_name also kills queued lock WAITERS — discriminate holders with a granted-advisory pg_locks predicate

## Problem

A lock-release path force-freed an advisory lock server-side with
`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 'db-serial-holder-<keyhash>-%'`.
A backend **waiting** in `pg_advisory_lock()` for that same key carries the *identical*
application_name as the holder (same wrapper spawned it, often the same session id), so
release terminated the holder AND every queued waiter — converting each
release-during-wait handoff into a spurious failure for the next acquirer, at the exact
moment the lock became free.

## Symptoms

- Empirically: with A holding and B queued, `release` → `pg_stat_activity` shows both
  backends matching the LIKE (holder `granted=true`, waiter `granted=false`); both die;
  B exits with "still held by (unknown)" while `status` says `free`.

## Root Cause

`application_name` identifies *who spawned the connection*, not *what it currently
possesses*. Holder and waiter are indistinguishable by name. Possession lives in
`pg_locks.granted`. (Also: `pg_stat_activity` is cluster-wide, while advisory locks are
per-database — an unscoped sweep can reach across databases.)

## Solution

Scope the terminate to the backend actually holding a granted advisory lock, in this
database:

```sql
SELECT pg_terminate_backend(a.pid)
FROM pg_stat_activity a
WHERE a.datname = current_database()
  AND a.application_name LIKE 'db-serial-holder-<keyhash>-%'
  AND EXISTS (SELECT 1 FROM pg_locks l
              WHERE l.pid = a.pid AND l.locktype = 'advisory' AND l.granted);
```

Apply the same predicate to any "who holds it" identity query — an unfiltered
`LIMIT 1` over the LIKE can name a waiter (even the caller itself) as the holder.

## Prevention

Pin the handoff sequence with a test: A acquires, B acquires in the background with a
generous wait, A releases, assert B exits 0. That test failed RED against the
name-only predicate and is the permanent regression guard.

## Related Files

- `scripts/pg-lab/db-serial-lock.sh` — `do_release`, `do_status`, acquire's holder-identity query
- `.claude/hooks/test-db-serial-lock.sh` — the handoff assertion

## See Also

- [postgres-pg-sleep-backend-ignores-dead-client](postgres-pg-sleep-backend-ignores-dead-client-2026-07-10.md) — why terminate-first became the authoritative release
- [../design-patterns/advisory-lock-per-user-rate-limiting-2026-05-13.md](../design-patterns/advisory-lock-per-user-rate-limiting-2026-05-13.md) — in-transaction xact-scoped advisory locks (different lifetime model)
