#!/usr/bin/env bash
# Unit test for scripts/pg-lab/session-coord.sh + schema/session-coordination.sql.
# Run by CI (Lint · Types · Patterns job) via scripts/run-hook-tests.sh's glob — that job
# has NO postgres service, so this must SKIP cleanly (exit 0) when Postgres is unreachable,
# mirroring .claude/hooks/test-pg-lab-log-injection.sh.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/session-coord.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/session-coordination.sql"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_exit()     { if [ "$2" -eq "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit $3, got $2"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $2"; FAIL=1; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }
command -v jq   >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }

# --- lib/ps-walk.sh (no DB needed) ---------------------------------------------------
PSWALK="$PROJECT_ROOT/scripts/pg-lab/lib/ps-walk.sh"
[ -f "$PSWALK" ] || { echo "FAIL: lib/ps-walk.sh missing"; FAIL=1; }

# resolve_claude_pid: walking from a shell with no claude ancestor must rc-1 quietly.
# (CI runners have no `claude` process; locally the test still passes because we start
# the walk from a detached `sleep` whose ancestry tops out at the test shell.)
WALK_OUT=$( (. "$PSWALK" && resolve_claude_pid 1) 2>&1 ); WALK_RC=$?
assert_eq "ps-walk: pid 1 has no claude ancestor -> rc 1" "$WALK_RC" "1"
assert_empty "ps-walk: failure prints nothing" "$WALK_OUT"

# bridge round-trip: bridge_file is a pure path function; resolve_session_id reads it.
FAKE_PID=99999999
BRIDGE=$( (. "$PSWALK" && bridge_file "$FAKE_PID") )
assert_eq "ps-walk: bridge_file path shape" "$BRIDGE" "/tmp/claude-session-coord-pid-${FAKE_PID}.sid"

# resolve_session_id with a stubbed resolve_claude_pid: overriding the function after
# sourcing proves resolve_session_id composes the two helpers rather than re-walking.
SID_OUT=$( (
  . "$PSWALK"
  resolve_claude_pid() { echo "$FAKE_PID"; }
  printf 'sess-bridge-test' > "/tmp/claude-session-coord-pid-${FAKE_PID}.sid"
  resolve_session_id
  rm -f "/tmp/claude-session-coord-pid-${FAKE_PID}.sid"
) )
assert_eq "ps-walk: resolve_session_id reads the bridge" "$SID_OUT" "sess-bridge-test"

psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

TEST_DB="pg_lab_session_coord_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
cleanup() { psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1; rm -f /tmp/claude-session-coord-*-test-$$* 2>/dev/null; }
trap cleanup EXIT

LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
assert_exit0 "init.sh creates the throwaway DB" "$?"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "session-coordination.sql applies cleanly" "$?"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "schema is idempotent (second apply clean)" "$?"
COLS=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='harness' AND table_name IN ('session_registry','files_in_flight','coordination_log')")
[ "$COLS" -ge 18 ] && echo "ok: expected columns present" || { echo "FAIL: columns missing ($COLS)"; FAIL=1; }

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
