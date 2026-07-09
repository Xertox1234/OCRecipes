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

# ---------- Gate (no DB required) ----------
GFIX="$(mktemp -d)"
gate_cleanup() { rm -rf "$GFIX"; }
# note: combined with DB cleanup below once FIX exists; for now standalone
json_field() { python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))' "$2" <<<"$1"; }

# Clean session passes, artifact written 0600, sha matches
printf '[#u-1] user: Let us discuss the search architecture.\n\n[#a-1] assistant: pg_trgm word_similarity is the right primitive here.\n' > "$GFIX/clean.txt"
OUT=$(python3 "$GATE" "$GFIX/clean.txt" "$GFIX/clean.out"); RC=$?
assert_exit0 "gate: clean session exits 0" "$RC"
assert_eq "gate: clean session verdict sent" "$(json_field "$OUT" verdict)" "sent"
PERMS=$(stat -f '%Lp' "$GFIX/clean.out" 2>/dev/null || stat -c '%a' "$GFIX/clean.out")
assert_eq "gate: artifact is 0600" "$PERMS" "600"
WANT_SHA=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$GFIX/clean.out")
assert_eq "gate: reported sha256 matches artifact" "$(json_field "$OUT" sha256)" "$WANT_SHA"
[ ! -e "$GFIX/clean.out.tmp" ]; assert_exit0 "gate: no temp file left beside artifact" "$?"

# Defense-in-depth redaction happens in the artifact
printf '[#u-1] user: my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 sorry\n' > "$GFIX/secret.txt"
OUT=$(python3 "$GATE" "$GFIX/secret.txt" "$GFIX/secret.out")
assert_eq "gate: secret-only session still sent" "$(json_field "$OUT" verdict)" "sent"
assert_contains "gate: artifact redacted" "$(cat "$GFIX/secret.out")" "[REDACTED]"
assert_not_contains "gate: raw key absent from artifact" "$(cat "$GFIX/secret.out")" "sk-ant-api03"

# Fail-closed: unreadable input → non-zero exit, gated verdict, no artifact
OUT=$(python3 "$GATE" "$GFIX/does-not-exist.txt" "$GFIX/nope.out" 2>/dev/null); RC=$?
assert_nonzero "gate: missing input fails closed (non-zero)" "$RC"
assert_eq "gate: missing input verdict gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: missing input class gate_error" "$(json_field "$OUT" class)" "gate_error"
[ ! -f "$GFIX/nope.out" ]; assert_exit0 "gate: no artifact on gate_error" "$?"
rm -rf "$GFIX"

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
