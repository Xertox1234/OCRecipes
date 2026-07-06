#!/usr/bin/env bash
# Unit test for scripts/pg-lab/log-injection.sh. Run by CI (Lint · Types · Patterns job) via
# scripts/run-hook-tests.sh's `.claude/hooks/test-*.sh` glob.
#
# That job has NO postgres service (only the Tests/Coverage jobs do — see
# .github/workflows/ci.yml), so this test must SKIP cleanly, never fail, when Postgres is
# unreachable — same fail-silent contract the script itself implements. Locally (or in any
# CI job with a live Postgres) it does a real insert round-trip against a throwaway database.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/log-injection.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/injection-log.sql"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $2"; FAIL=1; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }

# Fail-silent contract: an unreachable/nonexistent lab DB must no-op (empty stdout, exit 0),
# and it must never hang the caller — check this against a definitely-bogus URL before we
# even know whether a local Postgres server is running.
LINE=$(printf 'sid\x1fEdit\x1ffoo.ts\x1fapi\x1finjected\x1f100\x1fdocs/rules/api.md\n')
OUT=$(printf '%s' "$LINE" | LAB_DATABASE_URL="postgresql://localhost/pg_lab_does_not_exist_$$" bash "$SCRIPT" 2>/dev/null); RC=$?
assert_empty "unreachable DB -> no output" "$OUT"
assert_exit0 "unreachable DB -> exit 0" "$RC"

# Hard safety rail: LAB_DATABASE_URL resolving to a real app database must be refused (still
# exit 0 — this script is never human-invoked directly and must never break its caller — but
# it must never touch the database). No live Postgres needed: the guard is a pure string
# check that runs before the first psql call.
ERR=$(printf '%s' "$LINE" | LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$SCRIPT" 2>&1 1>/dev/null); RC=$?
assert_exit0 "refuses LAB_DATABASE_URL=nutricam (still exit 0, fail-silent)" "$RC"
assert_contains "refusal names nutricam" "$ERR" "nutricam"

# Query-string-smuggling regression (docs/solutions/logic-errors/
# denylist-bypassed-by-connection-string-query-string-2026-07-06.md): a raw `${VAR##*/}`
# split lets `nutricam?sslmode=require` sail past the denylist while psql still connects
# to the real database.
QS_ERR=$(printf '%s' "$LINE" | LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$SCRIPT" 2>&1 1>/dev/null); QS_RC=$?
assert_exit0 "refuses nutricam+query-string (still exit 0, fail-silent)" "$QS_RC"
assert_contains "query-string refusal names nutricam" "$QS_ERR" "nutricam"

# A line with no trailing newline (a caller that forgets it, e.g. a single-record log line
# built via command substitution, which strips trailing newlines) must still be processed —
# `read` returns non-zero at EOF-without-newline even though it populated the variables; the
# `|| [ -n "$session_id" ]` guard in the script's while-loop is what makes this work. Verified
# to actually reach the DB below (round 2), not just parse without erroring.
printf '%s' "$LINE" | LAB_DATABASE_URL="postgresql://localhost/pg_lab_does_not_exist_$$" bash "$SCRIPT" >/dev/null 2>&1
assert_exit0 "no-trailing-newline input still exits 0 against unreachable DB" "$?"

# The rest needs a live local Postgres to create a throwaway test DB. Skip (not fail) when
# there is none — mirrors the jq-unavailable skip in test-session-recent-issues.sh.
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

TEST_DB="pg_lab_log_injection_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
cleanup() { psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1; }
trap cleanup EXIT

LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
assert_exit0 "init.sh creates the throwaway DB" "$?"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "injection-log.sql applies cleanly" "$?"

# Round 1: a normal domain-scoped record with a doc_paths array. NOTE: `$(...)` strips the
# trailing newline this printf writes — every REC# below is implicitly a no-trailing-newline
# input, which is exactly the case the `|| [ -n "$session_id" ]` read-loop guard exists for.
REC1=$(printf 'sess-a\x1fEdit\x1fserver/routes/foo.ts\x1fapi\x1finjected\x1f1234\x1fdocs/rules/api.md,docs/solutions/api/foo-2026-01-01.md\n')
printf '%s' "$REC1" | LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" >/dev/null 2>&1
ROWCOUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.injection_log")
assert_eq "round 1: one row inserted" "$ROWCOUNT" "1"

ROW=$(psql -X -q -tA -F'|' -d "$TEST_URL" -c "SELECT session_id, tool, edited_path, domain, action, payload_bytes, doc_paths FROM harness.injection_log ORDER BY id LIMIT 1")
assert_eq "round 1: session_id" "$(printf '%s' "$ROW" | cut -d'|' -f1)" "sess-a"
assert_eq "round 1: domain" "$(printf '%s' "$ROW" | cut -d'|' -f4)" "api"
assert_eq "round 1: action" "$(printf '%s' "$ROW" | cut -d'|' -f5)" "injected"
assert_eq "round 1: payload_bytes" "$(printf '%s' "$ROW" | cut -d'|' -f6)" "1234"
assert_eq "round 1: doc_paths array" "$(printf '%s' "$ROW" | cut -d'|' -f7)" "{docs/rules/api.md,docs/solutions/api/foo-2026-01-01.md}"

# Round 2: a SessionStart-shaped record — edited_path AND domain both empty, i.e. TWO
# adjacent empty fields (exactly why the delimiter is \x1f, not \t: bash's `read` collapses
# adjacent tab-delimited empty fields even with IFS set to tab alone, which would otherwise
# misalign every field after them — verified empirically during implementation).
REC2=$(printf 'sess-b\x1fSessionStart\x1f\x1f\x1finjected\x1f42\x1fdocs/solutions/conventions/foo.md')
printf '%s' "$REC2" | LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" >/dev/null 2>&1
ROWCOUNT2=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.injection_log")
assert_eq "round 2: SessionStart row (no trailing newline) still inserted" "$ROWCOUNT2" "2"

ROW2=$(psql -X -q -tA -F'|' -d "$TEST_URL" -c "SELECT session_id, tool, edited_path, domain, action, payload_bytes FROM harness.injection_log ORDER BY id OFFSET 1 LIMIT 1")
assert_eq "round 2: session_id" "$(printf '%s' "$ROW2" | cut -d'|' -f1)" "sess-b"
assert_eq "round 2: tool" "$(printf '%s' "$ROW2" | cut -d'|' -f2)" "SessionStart"
assert_eq "round 2: edited_path empty" "$(printf '%s' "$ROW2" | cut -d'|' -f3)" ""
assert_eq "round 2: domain empty" "$(printf '%s' "$ROW2" | cut -d'|' -f4)" ""

# Round 3: a pointer record with an empty doc_paths (trailing empty field) must load as {}.
REC3=$(printf 'sess-c\x1fEdit\x1ffoo.ts\x1fsecurity\x1fpointer\x1f0\x1f\n')
printf '%s' "$REC3" | LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" >/dev/null 2>&1
DOCS3=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT doc_paths FROM harness.injection_log WHERE session_id='sess-c'")
assert_eq "round 3: pointer row has empty array doc_paths" "$DOCS3" "{}"

# Round 4: MULTIPLE records in a single call, mirroring inject-patterns.sh's real usage —
# its LOG_TSV accumulator concatenates one \x1f-delimited, \n-terminated line per domain
# outcome and hands the whole batch to log-injection.sh in ONE invocation.
MULTI="$(printf 'sess-d\x1fEdit\x1fa.ts\x1fapi\x1finjected\x1f10\x1f\n'; printf 'sess-d\x1fEdit\x1fa.ts\x1farchitecture\x1fdeferred\x1f20\x1f\n')"$'\n'
printf '%s' "$MULTI" | LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" >/dev/null 2>&1
ROWCOUNT4=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.injection_log WHERE session_id='sess-d'")
assert_eq "round 4: both records in one call are inserted" "$ROWCOUNT4" "2"

# Round 5: a doc_path containing a literal double quote must be Postgres-array-literal
# escaped with a BACKSLASH, not doubled (doubling is CSV/SQL-string-literal convention, not
# array-literal convention — using it produces a malformed array literal that silently drops
# the whole row under the script's `|| true` guard). Regression test for a bug found during
# code review.
REC5=$(printf 'sess-e\x1fEdit\x1ffoo.ts\x1fapi\x1finjected\x1f10\x1fdocs/solutions/foo"bar.md,docs/rules/api.md\n')
printf '%s' "$REC5" | LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" >/dev/null 2>&1
ROWCOUNT5=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.injection_log WHERE session_id='sess-e'")
assert_eq "round 5: doc_path with a literal quote is still inserted (not silently dropped)" "$ROWCOUNT5" "1"
DOCS5=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT doc_paths FROM harness.injection_log WHERE session_id='sess-e'")
assert_eq "round 5: quote is backslash-escaped in the array literal" "$DOCS5" '{"docs/solutions/foo\"bar.md",docs/rules/api.md}'

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
