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
# (CI runners have no claude process; pid 1's guard stops the walk before any ps call.)
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

# Positive walk: a real ancestor whose argv ends in "/claude" (no trailing args — the
# launcher shape the argv fallback must catch) is found from a grandchild shell.
TMPD=$(mktemp -d /tmp/pswalk-test-XXXXXX)
cat > "$TMPD/claude" <<EOF
#!/usr/bin/env bash
echo \$\$ > "$TMPD/expected-pid"
bash -c '. "$PSWALK" && resolve_claude_pid' > "$TMPD/walk-out" 2>/dev/null
EOF
chmod +x "$TMPD/claude"
"$TMPD/claude"
assert_eq "ps-walk: walk finds no-args claude ancestor" "$(cat "$TMPD/walk-out" 2>/dev/null)" "$(cat "$TMPD/expected-pid" 2>/dev/null)"
rm -rf "$TMPD"

# resolve_session_id with NO bridge file -> rc 1, silent.
SID_RC=$( (. "$PSWALK"; resolve_claude_pid() { echo 424242; }; resolve_session_id >/dev/null 2>&1; echo $?) )
assert_eq "ps-walk: missing bridge -> rc 1" "$SID_RC" "1"

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

# --- session-coord.sh write path ------------------------------------------------------
export LAB_DATABASE_URL="$TEST_URL"
REPO_ROOT_NOW=$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel)

# Fail-silent + denylist (no live DB needed for these two, but grouped here for flow):
OUT=$(printf '{"session_id":"s1","cwd":"%s"}' "$PROJECT_ROOT" | LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" bash "$SCRIPT" register --stdin-json 2>/dev/null); RC=$?
assert_exit0 "register vs unreachable DB -> exit 0" "$RC"; assert_empty "register vs unreachable DB -> silent" "$OUT"
ERR=$(printf '{}' | LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$SCRIPT" register --stdin-json 2>&1 1>/dev/null); RC=$?
assert_exit0 "denylist refusal still exit 0" "$RC"; assert_contains "denylist names nutricam" "$ERR" "nutricam"

# register (hook mode): upserts row + writes bridge for a stubbed claude pid.
STUB_PID=88888888
printf '{"session_id":"sess-reg","cwd":"%s"}' "$PROJECT_ROOT" \
  | SESSION_COORD_CLAUDE_PID="$STUB_PID" bash "$SCRIPT" register --stdin-json >/dev/null 2>&1
assert_exit0 "register hook-mode exits 0" "$?"
ROW=$(psql -X -qtA -F'|' -d "$TEST_URL" -c "SELECT session_id, repo_root, session_kind FROM harness.session_registry WHERE session_id='sess-reg'")
assert_eq "register row: id+root" "$(cut -d'|' -f1-2 <<<"$ROW")" "sess-reg|$REPO_ROOT_NOW"
assert_eq "register bridge file content" "$(cat "/tmp/claude-session-coord-pid-${STUB_PID}.sid" 2>/dev/null)" "sess-reg"

# register (CLI mode): --kind re-upserts the SAME row via the bridge.
SESSION_COORD_CLAUDE_PID="$STUB_PID" bash "$SCRIPT" register --kind todo-executor >/dev/null 2>&1
KIND=$(psql -X -qtA -d "$TEST_URL" -c "SELECT session_kind FROM harness.session_registry WHERE session_id='sess-reg'")
assert_eq "register --kind re-upserts kind" "$KIND" "todo-executor"
NROWS=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.session_registry")
assert_eq "register --kind did not create a second row" "$NROWS" "1"

# record: files_in_flight upsert with per-file rel_path; heartbeat bumps expires_at.
printf '{"session_id":"sess-reg","tool_name":"Edit","tool_input":{"file_path":"%s/package.json"}}' "$REPO_ROOT_NOW" \
  | bash "$SCRIPT" record --stdin-json >/dev/null 2>&1
FROW=$(psql -X -qtA -F'|' -d "$TEST_URL" -c "SELECT abs_path, rel_path FROM harness.files_in_flight WHERE session_id='sess-reg'")
assert_eq "record: abs+rel path" "$FROW" "$REPO_ROOT_NOW/package.json|package.json"

# record self-heals a reaped row (kind degrades to unknown — informational only).
psql -X -q -d "$TEST_URL" -c "DELETE FROM harness.session_registry" >/dev/null
printf '{"session_id":"sess-reg","tool_name":"Edit","tool_input":{"file_path":"%s/package.json"}}' "$REPO_ROOT_NOW" \
  | bash "$SCRIPT" record --stdin-json >/dev/null 2>&1
NROWS=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.session_registry WHERE session_id='sess-reg'")
assert_eq "record recreates a reaped registry row" "$NROWS" "1"

# reap: expired rows (and their files, via cascade) vanish.
psql -X -q -d "$TEST_URL" -c "UPDATE harness.session_registry SET expires_at = now() - interval '1 minute'" >/dev/null
bash "$SCRIPT" reap >/dev/null 2>&1
NROWS=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.session_registry")
NFILES=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.files_in_flight")
assert_eq "reap deletes expired sessions" "$NROWS" "0"
assert_eq "reap cascades to files" "$NFILES" "0"

# deregister: removes row + bridge file.
printf '{"session_id":"sess-dereg","cwd":"%s"}' "$PROJECT_ROOT" \
  | SESSION_COORD_CLAUDE_PID="$STUB_PID" bash "$SCRIPT" register --stdin-json >/dev/null 2>&1
printf '{"session_id":"sess-dereg"}' | SESSION_COORD_CLAUDE_PID="$STUB_PID" bash "$SCRIPT" deregister --stdin-json >/dev/null 2>&1
NROWS=$(psql -X -qtA -d "$TEST_URL" -c "SELECT count(*) FROM harness.session_registry WHERE session_id='sess-dereg'")
assert_eq "deregister removes the row" "$NROWS" "0"
[ ! -f "/tmp/claude-session-coord-pid-${STUB_PID}.sid" ] && echo "ok: deregister removes bridge" || { echo "FAIL: bridge survived deregister"; FAIL=1; }

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
