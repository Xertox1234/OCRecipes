#!/usr/bin/env bash
# Session coordination v2 (spec 2026-09-27 §5–§6): per-actor records, Bash coverage,
# sibling visibility, collision ask. Throwaway DB like test-session-coord.sh; SKIPS
# (prints "skip:", exit 0) when Postgres is unreachable — CI's Lint job has none.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/session-coord.sh"
SHIM="$HOOK_DIR/session-coord-hook.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/session-coordination.sql"
FAIL=0
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected [$3], got [$2]"; FAIL=1; fi; }
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got [$2]"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing [$3] in [$2]"; FAIL=1; fi; }
command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }
command -v jq   >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

ME="v2me-$$"; OTHER="v2other-$$"
TEST_DB="pg_lab_session_coord_v2_$$"; TEST_URL="postgresql://localhost/$TEST_DB"
TMPB=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/sc-v2-XXXXXX")" && pwd -P)
SNAPF="/tmp/claude-session-coord-${ME}.json"
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE)" >/dev/null 2>&1
  rm -rf "$TMPB" "/tmp/claude-session-coord-${ME}.asks" "$SNAPF" 2>/dev/null
  rmdir "/tmp/claude-session-coord-${ME}.refresh-lock" 2>/dev/null
}
trap cleanup EXIT
age_file() { perl -e '$t = time - $ARGV[1]; utime $t, $t, $ARGV[0]' "$1" "$2"; }
q() { psql -X -qtA -F'|' -d "$TEST_URL" -c "$1"; }

# Legacy (pre-v2) tables first, so applying the schema exercises the migration path.
LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" >/dev/null 2>&1 <<'SQL'
CREATE TABLE harness.session_registry (session_id TEXT PRIMARY KEY, pid INTEGER, repo_root TEXT NOT NULL,
  branch TEXT, head_sha TEXT, session_kind TEXT NOT NULL DEFAULT 'unknown',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes');
CREATE TABLE harness.files_in_flight (session_id TEXT NOT NULL REFERENCES harness.session_registry(session_id) ON DELETE CASCADE,
  abs_path TEXT NOT NULL, rel_path TEXT NOT NULL, first_touch TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_touch TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (session_id, abs_path));
INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('legacy', '/tmp/l');
INSERT INTO harness.files_in_flight (session_id, abs_path, rel_path) VALUES ('legacy', '/tmp/l/a.ts', 'a.ts');
SQL
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_eq "schema: migrates a legacy DB cleanly" "$?" "0"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_eq "schema: idempotent" "$?" "0"
assert_eq "schema: legacy row kept with agent_id ''" "$(q "SELECT agent_id FROM harness.files_in_flight WHERE session_id='legacy'")" ""
assert_eq "schema: PK is (session_id, agent_id, abs_path)" \
  "$(q "SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum WHERE c.conrelid = 'harness.files_in_flight'::regclass AND c.contype = 'p'")" \
  "session_id,agent_id,abs_path"
q "DELETE FROM harness.session_registry" >/dev/null
export LAB_DATABASE_URL="$TEST_URL"

mkgit() { mkdir -p "$TMPB/$1"; git -C "$TMPB/$1" init -q; printf '%s' "$TMPB/$1"; }
R1=$(mkgit r1); R2=$(mkgit r2)
rec() { bash "$SCRIPT" record --stdin-json; }

# --- record (Task 7) ---------------------------------------------------------------------
jq -n --arg s "$ME" --arg f "$R1/src/a.ts" '{session_id:$s, agent_id:"agentA1", tool_name:"Write", tool_input:{file_path:$f}}' | rec
assert_eq "record: subagent row keyed by agent_id" "$(q "SELECT agent_id, rel_path FROM harness.files_in_flight WHERE abs_path='$R1/src/a.ts'")" "agentA1|src/a.ts"
jq -n --arg s "$ME" --arg f "$R1/src/a.ts" '{session_id:$s, tool_name:"Edit", tool_input:{file_path:$f}}' | rec
assert_eq "record: main agent row is agent_id ''" "$(q "SELECT count(*) FROM harness.files_in_flight WHERE abs_path='$R1/src/a.ts'")" "2"
jq -n --arg s "$ME" --arg c "rm src/b.ts && echo hi > c.txt" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | rec
assert_eq "record: Bash targets recorded" "$(q "SELECT string_agg(rel_path, ',' ORDER BY rel_path) FROM harness.files_in_flight WHERE abs_path IN ('$R1/src/b.ts','$R1/c.txt')")" "c.txt,src/b.ts"
jq -n --arg s "$ME" --arg c "cd src && rm d.ts" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | rec
assert_eq "record: Bash after cd records nothing relative" "$(q "SELECT count(*) FROM harness.files_in_flight WHERE abs_path LIKE '%d.ts'")" "0"

# PIN: `resolve_write_targets` emits /dev/null as a target for `> /dev/null`. record_one must
# drop it naturally (git_root_of("/dev") fails) — never insert a /dev row.
jq -n --arg s "$ME" --arg c "echo hi > /dev/null && rm src/e.ts" --arg cwd "$R1" '{session_id:$s, tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}' | rec
assert_eq "record: Bash writes past /dev/null still records the real target" "$(q "SELECT rel_path FROM harness.files_in_flight WHERE abs_path='$R1/src/e.ts'")" "src/e.ts"
assert_eq "record: nothing under /dev is ever recorded" "$(q "SELECT count(*) FROM harness.files_in_flight WHERE abs_path LIKE '/dev/%'")" "0"

assert_eq "record: TTL is 15 minutes" "$(q "SELECT extract(epoch FROM expires_at - last_seen_at)::int FROM harness.session_registry WHERE session_id='$ME'")" "900"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
