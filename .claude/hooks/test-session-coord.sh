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

# Test-fixture identifiers, $$-scoped so two suite runs executing concurrently on one
# machine (parallel preflights do happen) never collide on shared /tmp paths or DB pids.
STUB_PID=$((80000000 + $$))
FAKE_PID=$((90000000 + $$))
STUB_PID_B=$((70000000 + $$))
MYSID="me-$$"
OTHERSID="other-$$"

# --- lib/ps-walk.sh (no DB needed) ---------------------------------------------------
PSWALK="$PROJECT_ROOT/scripts/pg-lab/lib/ps-walk.sh"
[ -f "$PSWALK" ] || { echo "FAIL: lib/ps-walk.sh missing"; FAIL=1; }

# resolve_claude_pid: walking from a shell with no claude ancestor must rc-1 quietly.
# (CI runners have no claude process; pid 1's guard stops the walk before any ps call.)
WALK_OUT=$( (. "$PSWALK" && resolve_claude_pid 1) 2>&1 ); WALK_RC=$?
assert_eq "ps-walk: pid 1 has no claude ancestor -> rc 1" "$WALK_RC" "1"
assert_empty "ps-walk: failure prints nothing" "$WALK_OUT"

# bridge round-trip: bridge_file is a pure path function; resolve_session_id reads it.
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

# --- hook wrapper (no DB needed) -------------------------------------------------------
WRAPPER="$PROJECT_ROOT/.claude/hooks/session-coord-hook.sh"
[ -f "$WRAPPER" ] || { echo "FAIL: session-coord-hook.sh missing"; FAIL=1; }
# Write-path calls must return immediately (<2s even though the child sleeps via an
# unreachable "DB" that has PGCONNECT_TIMEOUT=2), silently, exit 0.
START=$(date +%s)
OUT=$(printf '{"session_id":"w1","cwd":"/tmp"}' | SESSION_COORD_CLAUDE_PID="$STUB_PID_B" LAB_DATABASE_URL="postgresql://10.255.255.1/lab" bash "$WRAPPER" register 2>/dev/null); RC=$?
ELAPSED=$(( $(date +%s) - START ))
assert_exit0 "wrapper register exit 0" "$RC"
assert_empty "wrapper register silent" "$OUT"
[ "$ELAPSED" -le 1 ] && echo "ok: wrapper backgrounds (returned in ${ELAPSED}s)" || { echo "FAIL: wrapper blocked ${ELAPSED}s"; FAIL=1; }
# Unknown subcommand: silent no-op.
OUT=$(printf '{}' | bash "$WRAPPER" bogus 2>/dev/null); RC=$?
assert_exit0 "wrapper bogus subcommand exit 0" "$RC"; assert_empty "wrapper bogus silent" "$OUT"
# settings.json wiring present:
for pair in "SessionStart:register" "PostToolUse:record" "SessionEnd:deregister" "PreToolUse:consult"; do
  grep -q "session-coord-hook.sh ${pair#*:}" "$PROJECT_ROOT/.claude/settings.json" \
    && echo "ok: settings wires ${pair}" || { echo "FAIL: settings missing ${pair}"; FAIL=1; }
done

# Fail-silent + denylist (no live DB needed for these two — only the psql binary, which
# CI has — so they run ahead of the live-Postgres gate for CI coverage).
OUT=$(printf '{"session_id":"s1","cwd":"%s"}' "$PROJECT_ROOT" | SESSION_COORD_CLAUDE_PID="$STUB_PID_B" LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" bash "$SCRIPT" register --stdin-json 2>/dev/null); RC=$?
assert_exit0 "register vs unreachable DB -> exit 0" "$RC"; assert_empty "register vs unreachable DB -> silent" "$OUT"
ERR=$(printf '{}' | SESSION_COORD_CLAUDE_PID="$STUB_PID_B" LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$SCRIPT" register --stdin-json 2>&1 1>/dev/null); RC=$?
assert_exit0 "denylist refusal still exit 0" "$RC"; assert_contains "denylist names nutricam" "$ERR" "nutricam"

psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

TEST_DB="pg_lab_session_coord_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
cleanup() { psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1; rm -f /tmp/claude-session-coord-*-test-$$* 2>/dev/null; rm -f "/tmp/claude-session-coord-pid-${STUB_PID_B}.sid" "/tmp/claude-session-coord-pid-${STUB_PID}.sid" 2>/dev/null; rmdir "/tmp/claude-session-coord-${MYSID}.refresh-lock" 2>/dev/null; rm -f "/tmp/claude-session-coord-consult-me.json" 2>/dev/null; rmdir "/tmp/claude-session-coord-consult-me.refresh-lock" 2>/dev/null; }
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

# register (hook mode): upserts row + writes bridge for a stubbed claude pid.
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

# --- refresh-snapshot ------------------------------------------------------------------
# Seed two sessions: $MYSID and an $OTHERSID with one in-flight file.
psql -X -q -d "$TEST_URL" >/dev/null <<SQL
DELETE FROM harness.session_registry;
INSERT INTO harness.session_registry (session_id, repo_root, session_kind, branch) VALUES
 ('$MYSID',    '/tmp/checkout-a', 'interactive', 'main'),
 ('$OTHERSID', '/tmp/checkout-b', 'todo-executor', 'todo/foo');
INSERT INTO harness.files_in_flight (session_id, abs_path, rel_path) VALUES
 ('$OTHERSID', '/tmp/checkout-b/server/index.ts', 'server/index.ts');
SQL
bash "$SCRIPT" refresh-snapshot --session "$MYSID" >/dev/null 2>&1
assert_exit0 "refresh-snapshot exits 0" "$?"
SNAP="/tmp/claude-session-coord-${MYSID}.json"
N_OTHER=$(jq -r '.sessions | length' "$SNAP" 2>/dev/null)
assert_eq "snapshot lists only OTHER sessions" "$N_OTHER" "1"
assert_eq "snapshot session id" "$(jq -r '.sessions[0].session_id' "$SNAP")" "$OTHERSID"
assert_eq "snapshot carries files" "$(jq -r '.sessions[0].files[0].rel_path' "$SNAP")" "server/index.ts"
rm -f "$SNAP"
[ ! -d "/tmp/claude-session-coord-${MYSID}.refresh-lock" ] && echo "ok: refresh released its lockdir" || { echo "FAIL: lockdir leaked after successful refresh"; FAIL=1; }

# In-flight guard: a held lockdir makes a second refresh a silent no-op.
mkdir "/tmp/claude-session-coord-${MYSID}.refresh-lock"
bash "$SCRIPT" refresh-snapshot --session "$MYSID" >/dev/null 2>&1
assert_exit0 "guarded refresh still exits 0" "$?"
[ ! -f "$SNAP" ] && echo "ok: guarded refresh wrote nothing" || { echo "FAIL: guard ignored"; FAIL=1; }
rmdir "/tmp/claude-session-coord-${MYSID}.refresh-lock"

# --- consult -----------------------------------------------------------------------
SNAPME="/tmp/claude-session-coord-consult-me.json"
mk_consult_input() { printf '{"session_id":"consult-me","tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$1"; }
cat > "$SNAPME" <<JSON
{"sessions":[{"session_id":"other-sess","session_kind":"interactive","branch":"main","repo_root":"/tmp/checkout-a","last_seen_at":"2026-07-10T00:00:00Z","files":[
  {"abs_path":"/tmp/checkout-a/server/index.ts","rel_path":"server/index.ts"},
  {"abs_path":"/tmp/checkout-a/shared/schema.ts","rel_path":"shared/schema.ts"}]}]}
JSON
touch "$SNAPME"  # fresh mtime -> no refresh spawn during these assertions

# Level 1: same abs_path -> collision warning naming the other session.
# Note: msg uses ${osid:0:8} (short-ID abbreviation, matches real UUID session ids) --
# "other-sess" is 10 chars, so the message shows the 8-char prefix "other-se".
OUT=$(mk_consult_input "/tmp/checkout-a/server/index.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_contains "consult L1 emits additionalContext" "$OUT" '"hookEventName": "PreToolUse"'
assert_contains "consult L1 names other session" "$OUT" "other-se"
assert_contains "consult L1 says same checkout" "$OUT" "same checkout"

# Level 2: same rel_path, DIFFERENT repo_root (file lives in another worktree). do_consult
# resolves its own root via `git -C <dir> rev-parse --show-toplevel`, which requires a REAL
# git worktree on disk -- a literal, non-existent "/tmp/checkout-b" can never resolve. Build
# one via git's own toplevel output (dodges the macOS /tmp -> /private/tmp symlink mismatch
# that a bare `mkdir /tmp/checkout-b` would hit).
CKB=$(d=$(mktemp -d); git -C "$d" init -q; git -C "$d" rev-parse --show-toplevel)
OUT=$(mk_consult_input "$CKB/shared/schema.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_contains "consult L2 emits worktree note" "$OUT" "another worktree"
rm -rf "$CKB"

# No match -> silent.
OUT=$(mk_consult_input "/tmp/checkout-b/client/App.tsx" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_empty "consult no-match silent" "$OUT"

# Self-suppression: a snapshot row with OUR session_id must never warn.
cat > "$SNAPME" <<JSON
{"sessions":[{"session_id":"consult-me","session_kind":"interactive","branch":"main","repo_root":"/tmp/checkout-a","last_seen_at":"2026-07-10T00:00:00Z","files":[{"abs_path":"/tmp/x.ts","rel_path":"x.ts"}]}]}
JSON
touch "$SNAPME"
OUT=$(mk_consult_input "/tmp/x.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_empty "consult self-suppressed" "$OUT"

# Corrupt snapshot -> silent, exit 0.
printf 'not json' > "$SNAPME"; touch "$SNAPME"
OUT=$(mk_consult_input "/tmp/x.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null); RC=$?
assert_exit0 "consult corrupt snapshot exit 0" "$RC"; assert_empty "consult corrupt snapshot silent" "$OUT"

# Missing snapshot -> silent AND spawns a refresh (snapshot appears shortly).
rm -f "$SNAPME"
psql -X -q -d "$TEST_URL" -c "INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('consult-me','/tmp/checkout-c') ON CONFLICT (session_id) DO NOTHING" >/dev/null
OUT=$(mk_consult_input "/tmp/x.ts" | bash "$SCRIPT" consult --stdin-json 2>/dev/null)
assert_empty "consult missing snapshot silent" "$OUT"
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -f "$SNAPME" ] && break; sleep 0.3; done
[ -f "$SNAPME" ] && echo "ok: consult spawned async refresh" || { echo "FAIL: no refresh spawned"; FAIL=1; }
rm -f "$SNAPME"

# --- refresh-snapshot: stale-lock recovery -------------------------------------------
# A held lockdir with a FRESH mtime still blocks a refresh -- guard preserved.
mkdir "/tmp/claude-session-coord-${MYSID}.refresh-lock"
bash "$SCRIPT" refresh-snapshot --session "$MYSID" >/dev/null 2>&1
assert_exit0 "fresh-lock refresh still exits 0" "$?"
[ ! -f "$SNAP" ] && echo "ok: fresh lockdir still blocks refresh" || { echo "FAIL: fresh lockdir did not block refresh"; FAIL=1; }
rmdir "/tmp/claude-session-coord-${MYSID}.refresh-lock" 2>/dev/null

# A SIGKILL-orphaned lockdir (mtime > 60s old) gets broken -- refresh proceeds and the
# lockdir is left clean afterward (re-created + released, not leaked).
mkdir "/tmp/claude-session-coord-${MYSID}.refresh-lock"
touch -t 202001010000 "/tmp/claude-session-coord-${MYSID}.refresh-lock"
bash "$SCRIPT" refresh-snapshot --session "$MYSID" >/dev/null 2>&1
assert_exit0 "stale-lock refresh exits 0" "$?"
[ -f "$SNAP" ] && echo "ok: stale lock broken, snapshot written" || { echo "FAIL: stale lock still blocked refresh"; FAIL=1; }
[ ! -d "/tmp/claude-session-coord-${MYSID}.refresh-lock" ] && echo "ok: lockdir released cleanly after stale-break" || { echo "FAIL: lockdir leaked after stale-break"; FAIL=1; }
rm -f "$SNAP"

# --- attribute-drift ---------------------------------------------------------------
psql -X -q -d "$TEST_URL" >/dev/null <<'SQL'
DELETE FROM harness.session_registry;
INSERT INTO harness.session_registry (session_id, repo_root, session_kind, branch)
VALUES ('drift-other', '/tmp/checkout-a', 'goal', 'main');
SQL
OUT=$(bash "$SCRIPT" attribute-drift "drift-me" "/tmp/checkout-a" 2>/dev/null)
assert_contains "attribute: names other session" "$OUT" "drift-ot"
assert_contains "attribute: names kind" "$OUT" "goal"
OUT=$(bash "$SCRIPT" attribute-drift "drift-me" "/tmp/checkout-elsewhere" 2>/dev/null)
assert_contains "attribute: empty registry -> own-op line" "$OUT" "no other live session"
OUT=$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" bash "$SCRIPT" attribute-drift "x" "/y" 2>/dev/null); RC=$?
assert_exit0 "attribute: PG down exit 0" "$RC"; assert_empty "attribute: PG down silent" "$OUT"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
