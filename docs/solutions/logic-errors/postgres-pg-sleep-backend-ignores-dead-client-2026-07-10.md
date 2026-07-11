---
title: 'A Postgres backend inside pg_sleep never notices its client died — "connection death releases the lock" needs client_connection_check_interval'
track: bug
category: logic-errors
tags: [postgres, advisory-lock, pg-sleep, connection-death, pg-lab, bash]
module: server
applies_to: ["scripts/pg-lab/**/*.sh"]
symptoms: [Advisory lock (or any session-scoped resource) stays held long after the client process was killed −9, pg_stat_activity shows the backend active inside pg_sleep seconds/minutes after its client is gone, Orphan-cleanup tests that kill the client process time out waiting for the resource to free]
created: 2026-07-10
severity: high
---

# A Postgres backend inside pg_sleep never notices its client died — "connection death releases the lock" needs client_connection_check_interval

## Problem

A design held a `pg_advisory_lock` in an ephemeral background psql whose connection
lifetime was the lock lifetime, on the claim "crash → connection death → instant
release." On stock Postgres the claim is false: after `kill -9` of the psql client, the
lock stayed held. The holder pattern was
`SELECT pg_advisory_lock(...); SELECT pg_sleep(86400);` — the lock would have survived
up to 24 hours past client death.

## Symptoms

- Killing the client (kill −9, crash, reboot of the client side) does not free
  session-scoped server state (advisory locks, temp tables, listens).
- `pg_stat_activity` shows the backend `active`, `wait_event = PgSleep`, after the
  client pid no longer exists.

## Root Cause

`client_connection_check_interval` defaults to `0` (disabled). A backend only notices a
dead client socket when it next **reads or writes** the connection — and a backend
executing a long-running statement (`pg_sleep`, a big query, a blocked
`pg_advisory_lock` wait) does neither until the statement ends. TCP keepalive doesn't
help on local/unix-socket connections either. So "connection death" is only *detected*
at statement boundaries unless the check interval is armed.

## Solution

Arm the check session-level as the holder's FIRST statement (USERSET since PG 14 — no
superuser needed, scoped to that one connection):

```sql
SELECT set_config('client_connection_check_interval', '2s', false);
SELECT set_config('lock_timeout', :'lt', false);
SELECT pg_advisory_lock(hashtext(:'k'));
\echo ACQUIRED
SELECT pg_sleep(86400);
```

With it, the backend polls the socket every 2s even mid-`pg_sleep`, and client death
frees the lock within ~2s. State the ~2s bound honestly in comments — never "instantly."
On PG < 14 the `set_config` errors under `ON_ERROR_STOP`, which fail-closes the acquire
(no phantom) — acceptable degradation.

## Prevention

Any design whose safety story is "the resource dies with the connection" must name the
*detection* mechanism, not just the release mechanism. Test it with a real `kill -9` of
the client and a poll on the resource — the test that exposed this claim was exactly
that, and it failed against default Postgres.

## Related Files

- `scripts/pg-lab/db-serial-lock.sh` — `do_holder`'s SQL preamble
- `.claude/hooks/test-db-serial-lock.sh` — kill −9 and orphan-release tests

## See Also

- [pg-terminate-backend-appname-kills-queued-waiters](pg-terminate-backend-appname-kills-queued-waiters-2026-07-10.md) — the release half of the same lock's fixes
- [../design-patterns/background-lock-holder-watches-long-lived-ancestor.md](../design-patterns/background-lock-holder-watches-long-lived-ancestor-2026-07-10.md) — the client-side liveness net
