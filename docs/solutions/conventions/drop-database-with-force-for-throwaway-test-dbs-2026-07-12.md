---
title: 'Throwaway test-DB cleanup must use DROP DATABASE ... WITH (FORCE) — a plain drop blocks on an in-use connection and can still leave the DB behind'
track: knowledge
category: conventions
tags: [postgres, drop-database, pg-lab, testing, bash, cleanup, hooks]
module: shared
applies_to: ["scripts/pg-lab/**/*.sh", ".claude/hooks/test-*.sh"]
created: 2026-07-12
---

# Throwaway test-DB cleanup must use DROP DATABASE ... WITH (FORCE) — a plain drop blocks on an in-use connection and can still leave the DB behind

## Rule

Any hook/test cleanup trap that drops a throwaway, per-PID Postgres database
(`DROP DATABASE IF EXISTS "$DB"`) must add `WITH (FORCE)` (PG13+). A plain drop is not
made safe by `IF EXISTS` and a `2>&1` redirect — those only silence the *output*, not the
underlying failure mode: a plain `DROP DATABASE` against a database with an active
connection does not error out immediately. It blocks, retrying internally for a bounded
window while waiting for the other session to disconnect on its own. If a backgrounded
connection (a detached `... &` write) outlives that window, the drop gives up and the
throwaway DB is left behind — silently, because cleanup traps universally redirect
`2>&1` to stay quiet on the happy path.

## When this applies

- Any `.claude/hooks/test-*.sh` or `scripts/pg-lab/*.sh` cleanup trap (`trap cleanup EXIT`)
  that runs `psql ... -c "DROP DATABASE IF EXISTS \"$DB\""` against a throwaway,
  `$$`-scoped test database.
- Especially when the code under test backgrounds any DB write (`... &`) without waiting
  for it — e.g. a fire-and-forget telemetry/log_event insert — since that connection's
  lifetime is not bounded by the test's own control flow, so it can still be open when the
  cleanup trap fires.

## Why

Empirically verified on local PG18 (matches CI's `postgres:16` service — `WITH (FORCE)` is
PG13+, so both are covered): a plain `DROP DATABASE` against a DB held open by an active
`pg_sleep`-style connection did not error immediately. It blocked for the connection's
remaining lifetime; when that lifetime (15s in the reproduction) exceeded Postgres's
internal retry window (~10-11s measured here), the drop gave up and the target database
was still present afterward — the actual leak. `WITH (FORCE)` sidesteps this entirely: it
terminates other backends and drops the database immediately (verified returning in well
under 5s against the same still-open 15s-held connection). Because cleanup traps in this
codebase always redirect the drop's own stdout/stderr to `/dev/null 2>&1` to stay silent
on the happy path, a plain drop's multi-second stall — or its eventual failure — is
invisible; the next run only notices when a stale database name collision or accumulated
dev-DB clutter surfaces far downstream.

**PG12 caveat:** this codebase's documented minimum dev Postgres is 12+ (`docs/DEV_SETUP.md`,
`docs/ARCHITECTURE.md`), one version below `WITH (FORCE)`'s PG13+ floor. On a PG12 install,
`WITH (FORCE)` is an unrecognized-option error — silently swallowed by the same `2>&1` that
hid the original bug, reproducing this exact leak with zero signal that the fix didn't apply.
If you're touching one of these cleanup traps and might be on PG12, check first
(`psql -tAc 'SHOW server_version_num'`) and fall back to the `pg_terminate_backend`
alternative under Exceptions below, which works on any version.

**CI coverage caveat:** none of these hook self-tests run against Postgres in CI — the
`checks` job that executes `scripts/run-hook-tests.sh` has no `postgres:` service (see each
test file's own header comment); only the separate `test`/`integration-http`/`coverage` jobs
run `postgres:16`, and they don't execute `.claude/hooks/test-*.sh`. So this fix, and any
regression test for it, is verified locally by whoever touches the file — not by CI on every
push.

## Examples

```bash
# Cleanup trap for a throwaway test DB — always use FORCE, never a bare drop:
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE)" >/dev/null 2>&1
}
trap cleanup EXIT
```

A regression test must discriminate FORCE from non-FORCE by **time**, not just end-state —
a plain drop can still succeed eventually if the holder disconnects before the retry
window expires, so an end-state-only assertion can pass against unpatched code too:

```bash
psql -X -q -d "$TEST_URL" -c "SELECT pg_sleep(15)" >/dev/null 2>&1 &
HOLDER_PID=$!
# ...poll pg_stat_activity until the connection is confirmed live (datname=$TEST_DB)...
FORCE_START=$(date +%s)
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE)" >/dev/null 2>&1
FORCE_ELAPSED=$(( $(date +%s) - FORCE_START ))
[ "$FORCE_ELAPSED" -le 5 ] || echo "FAIL: took ${FORCE_ELAPSED}s"   # must return well under the holder's lifetime
```

## Exceptions

- An explicit `pg_terminate_backend` sweep scoped to `datname = '$DB'` is an equally valid
  alternative to `WITH (FORCE)` when the caller needs to terminate connections without
  dropping the database itself. If you do this, discriminate holders from queued lock
  waiters — `application_name` alone is not enough (see the related pg_terminate_backend
  solution below).
- A database that is never dropped by an automated trap (e.g. a developer's persistent
  shared `ocrecipes_lab`) is out of scope — this rule is specifically for throwaway,
  per-PID/per-test databases.

## Related Files

- `.claude/hooks/test-drift-detect.sh` — `cleanup()`'s `DROP DATABASE ... WITH (FORCE)` call
- `.claude/hooks/test-session-coord.sh` — `cleanup()`'s `DROP DATABASE ... WITH (FORCE)`
  call, plus the RED/GREEN-verified regression test proving the fix discriminates on speed
- `scripts/pg-lab/session-coord.sh` — `do_attribute_drift`'s backgrounded `log_event ... &`,
  the specific connection shape that motivated this rule

## See Also

- [../logic-errors/pg-terminate-backend-appname-kills-queued-waiters-2026-07-10.md](../logic-errors/pg-terminate-backend-appname-kills-queued-waiters-2026-07-10.md) — the manual pg_terminate_backend alternative and its own footgun (killing queued waiters, not just holders)
- [../logic-errors/postgres-pg-sleep-backend-ignores-dead-client-2026-07-10.md](../logic-errors/postgres-pg-sleep-backend-ignores-dead-client-2026-07-10.md) — a related "connection lifetime isn't what you assume" gotcha in the same pg-lab test suite
- [../logic-errors/backgrounded-child-holds-command-substitution-pipe-2026-07-10.md](../logic-errors/backgrounded-child-holds-command-substitution-pipe-2026-07-10.md) — the fd-detachment half of the same backgrounded log_event call sites
