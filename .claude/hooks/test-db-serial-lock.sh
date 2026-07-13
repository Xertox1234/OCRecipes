#!/usr/bin/env bash
# Unit test for scripts/pg-lab/db-serial-lock.sh. CI Lint job has no Postgres -> skip
# cleanly; locally exercises real advisory-lock races against a throwaway DB.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
LOCK="$PROJECT_ROOT/scripts/pg-lab/db-serial-lock.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/session-coordination.sql"
FAIL=0
assert_exit() { if [ "$2" -eq "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit $3, got $2"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_eq() { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected '$3', got '$2'"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }

# Fail-open: unreachable DB -> WARN on stderr, exit 0 (proceed unlocked).
OUT=$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" bash "$LOCK" acquire --watch-pid $$ 2>&1); RC=$?
assert_exit "PG down -> fail-open exit 0" "$RC" 0
assert_contains "PG down -> visible WARN" "$OUT" "proceeding unlocked"

# Denylist still applies.
OUT=$(LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$LOCK" acquire --watch-pid $$ 2>&1); RC=$?
assert_exit "denylist refusal exit 0" "$RC" 0
assert_contains "denylist names nutricam" "$OUT" "nutricam"

# Unresolvable watch-pid: no --watch-pid and no claude ancestor -> WARN + exit 3, no lock.
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }
TEST_DB="pg_lab_dbserial_test_$$"; TEST_URL="postgresql://localhost/$TEST_DB"
cleanup() { bash "$LOCK" release --key "k-$$" >/dev/null 2>&1; rm -f /tmp/claude-db-serial-*-k-$$* 2>/dev/null; psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE)" >/dev/null 2>&1; }
trap cleanup EXIT
LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
export LAB_DATABASE_URL="$TEST_URL"

OUT=$(SESSION_COORD_PS_WALK_DISABLE=1 bash "$LOCK" acquire --key "k-$$" 2>&1); RC=$?
assert_exit "unresolvable watch-pid -> exit 3" "$RC" 3
assert_contains "exit-3 WARN text" "$OUT" "watch-pid unresolvable"
STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
assert_contains "no lock taken on exit 3" "$STATUS" "free"

# Acquire + status + release round-trip (watch this test shell).
bash "$LOCK" acquire --key "k-$$" --watch-pid $$ --wait-secs 10 >/dev/null 2>&1
assert_exit "acquire succeeds" "$?" 0
STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
assert_contains "status shows held" "$STATUS" "held"
# Second acquirer with a short wait must time out with exit 2 and name the holder.
# WATCH_INTERVAL_SECS=1: the loser's wrapper must notice its psql's lock_timeout death
# promptly (the default 30s poll would outlive the acquirer's own wait budget).
OUT=$(WATCH_INTERVAL_SECS=1 bash "$LOCK" acquire --key "k-$$" --watch-pid $$ --wait-secs 3 2>&1); RC=$?
assert_exit "contended acquire -> exit 2" "$RC" 2
assert_contains "timeout names holder" "$OUT" "db-serial-holder-"
bash "$LOCK" release --key "k-$$" >/dev/null 2>&1
assert_exit "release exits 0" "$?" 0
STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
assert_contains "released -> free" "$STATUS" "free"

# Orphan release: watch a THROWAWAY pid (not the holder) and kill IT — proves the
# resolved watch-pid is what frees the lock (spec-review validation requirement).
sleep 300 & WATCHED=$!
WATCH_INTERVAL_SECS=1 bash "$LOCK" acquire --key "k-$$" --watch-pid "$WATCHED" --wait-secs 10 >/dev/null 2>&1
assert_exit "orphan-test acquire" "$?" 0
kill "$WATCHED" 2>/dev/null
for _ in $(seq 1 20); do
  STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
  grep -q free <<<"$STATUS" && break; sleep 0.5
done
assert_contains "killing WATCHED pid frees the lock" "$STATUS" "free"

# kill -9 the holder's CLIENT psql: connection death frees the lock instantly. Target the
# psql child of the wrapper (pgrep -P) — NOT the wrapper (that would orphan psql, which
# keeps the connection and the lock alive for up to 24h) and NOT the server backend
# (SIGKILL on a Postgres backend triggers cluster-wide crash recovery).
bash "$LOCK" acquire --key "k-$$" --watch-pid $$ --wait-secs 10 >/dev/null 2>&1
WRAPPER_PID=$(cat /tmp/claude-db-serial-*-k-$$*.pid 2>/dev/null | head -1)
PSQL_PID=$(pgrep -P "$WRAPPER_PID" 2>/dev/null | head -1)
kill -9 "$PSQL_PID" 2>/dev/null
for _ in $(seq 1 20); do
  STATUS=$(bash "$LOCK" status --key "k-$$" 2>/dev/null)
  grep -q free <<<"$STATUS" && break; sleep 0.5
done
assert_contains "kill -9 holder frees the lock" "$STATUS" "free"

# Handoff: A holds; B waits in background; A releases; B must ACQUIRE (exit 0), not die.
bash "$LOCK" acquire --key "k-$$" --watch-pid $$ --wait-secs 10 >/dev/null 2>&1
( WATCH_INTERVAL_SECS=1 bash "$LOCK" acquire --key "k-$$" --watch-pid $$ --wait-secs 15 >/dev/null 2>&1; echo $? > "/tmp/claude-db-serial-handoff-rc.$$" ) &
HANDOFF_WAITER=$!
sleep 2   # let B's holder queue on the advisory lock
bash "$LOCK" release --key "k-$$" >/dev/null 2>&1
wait "$HANDOFF_WAITER"
assert_eq "release hands off to queued waiter (exit 0)" "$(cat "/tmp/claude-db-serial-handoff-rc.$$" 2>/dev/null)" "0"
bash "$LOCK" release --key "k-$$" >/dev/null 2>&1
rm -f "/tmp/claude-db-serial-handoff-rc.$$"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
