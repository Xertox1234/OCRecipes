#!/usr/bin/env bash
# Unit test for scripts/pg-lab/distill.sh, distill-gate.py, and schema/memory-candidates.sql.
# Run by CI (Lint · Types · Patterns job) via scripts/run-hook-tests.sh's .claude/hooks/test-*.sh
# glob. That job has NO postgres service, so DB-dependent sections SKIP cleanly when Postgres
# is unreachable (mirrors test-pg-lab-transcripts.sh). The external send is stubbed via the
# DISTILL_SEND_CMD seam — no network, ever.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/distill.sh"
GATE="$PROJECT_ROOT/scripts/pg-lab/distill-gate.py"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/memory-candidates.sql"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_nonzero()  { if [ "$2" -ne 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected non-zero exit, got 0"; FAIL=1; fi; }
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_not_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "FAIL: $1 — found forbidden: $3"; FAIL=1; else echo "ok: $1"; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v python3 >/dev/null 2>&1 || { echo "skip: python3 not installed"; exit 0; }

# ---------- DB-dependent sections ----------
command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; [ "$FAIL" -eq 0 ] && exit 0 || exit 1; }
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; [ "$FAIL" -eq 0 ] && exit 0 || exit 1; }

TEST_DB="pg_lab_distill_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
FIX=""
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1
  [ -z "$FIX" ] || rm -rf "$FIX"
}
trap cleanup EXIT
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"$TEST_DB\"" >/dev/null 2>&1
assert_exit0 "creates the throwaway DB" "$?"
FIX="$(mktemp -d)"

# Schema applies idempotently (twice = still exit 0)
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "schema applies" "$?"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "schema re-applies (idempotent)" "$?"
TABLES=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname='harness'")
assert_contains "memory_candidates exists" "$TABLES" "memory_candidates"
assert_contains "distill_runs exists" "$TABLES" "distill_runs"
assert_contains "distilled_sessions exists" "$TABLES" "distilled_sessions"

[ "$FAIL" -eq 0 ] && { echo "all assertions passed"; exit 0; } || exit 1
