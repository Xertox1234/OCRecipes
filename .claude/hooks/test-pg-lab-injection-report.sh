#!/usr/bin/env bash
# Unit test for scripts/pg-lab/injection-report.sh's hard safety rail — covers the denylist
# only (a bogus/exact-match/query-string- or fragment-suffixed LAB_DATABASE_URL must be
# refused loudly, before any DB connection is attempted). Run by CI (Lint · Types · Patterns job) via
# scripts/run-hook-tests.sh's `.claude/hooks/test-*.sh` glob. This job has no Postgres
# service, but the safety-rail assertions below need none — the guard is a pure string
# check that runs before the first psql call.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/injection-report.sh"
FAIL=0
assert_nonzero()  { if [ "$2" -ne 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected non-zero exit, got 0"; FAIL=1; fi; }
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }

command -v bash >/dev/null 2>&1 || { echo "skip: bash not installed"; exit 0; }

# Hard safety rail: LAB_DATABASE_URL resolving to a real app database must be refused
# loudly by BOTH the exact-match and query-string-smuggled forms — no live Postgres
# needed, the guard is a pure string check that runs before the first psql call. Assert on
# the distinctive refusal text ("resolves to a real app database"), not merely "nutricam" —
# a query-string bypass that falls through to psql can also fail with an unrelated error
# that happens to mention "nutricam" (e.g. a missing-table error against the real DB), which
# would make a weaker assertion pass for the wrong reason.
ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$SCRIPT" 2>&1 1>/dev/null); RC=$?
assert_nonzero "injection-report.sh refuses LAB_DATABASE_URL=nutricam" "$RC"
assert_contains "refusal names nutricam" "$ERR" "nutricam"
assert_contains "refusal is the denylist rail, not a downstream error" "$ERR" "a real app database, not a PG Lab database"

# Query-string-smuggling regression (docs/solutions/logic-errors/
# denylist-bypassed-by-connection-string-query-string-2026-07-06.md): a raw `${VAR##*/}`
# split lets `nutricam?sslmode=require` sail past the denylist while psql still connects
# to the real database.
QS_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$SCRIPT" 2>&1 1>/dev/null); QS_RC=$?
assert_nonzero "injection-report.sh refuses nutricam+query-string" "$QS_RC"
assert_contains "query-string refusal names nutricam" "$QS_ERR" "nutricam"
assert_contains "query-string refusal is the denylist rail, not a downstream error" "$QS_ERR" "a real app database, not a PG Lab database"

# Fragment-smuggling regression, same root cause as the query-string case. Assert on the
# distinctive denylist message, not merely "nutricam" — a fragment that falls through to
# psql fails with an unrelated "cannot reach" connection error that also mentions
# "nutricam", which would make a weaker assertion pass for the wrong reason (verified against
# the pre-fix script).
FRAG_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam#anchor" bash "$SCRIPT" 2>&1 1>/dev/null); FRAG_RC=$?
assert_nonzero "injection-report.sh refuses nutricam+fragment" "$FRAG_RC"
assert_contains "fragment refusal names nutricam" "$FRAG_ERR" "nutricam"
assert_contains "fragment refusal is the denylist rail, not a downstream error" "$FRAG_ERR" "a real app database, not a PG Lab database"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
