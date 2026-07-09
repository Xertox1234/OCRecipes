#!/usr/bin/env bash
# Unit test for scripts/pg-lab/contract-diff.sh (and, incidentally,
# scripts/pg-lab/schema/contract-snapshots.sql / scripts/pg-lab/init.sh — the round-trip
# below creates a throwaway lab DB through init.sh). Run by CI (Lint · Types · Patterns
# job) via scripts/run-hook-tests.sh's `.claude/hooks/test-*.sh` glob.
#
# That job has NO postgres service (only the Tests/Coverage jobs do — see
# .github/workflows/ci.yml), so this test must SKIP cleanly, never fail, when Postgres
# is unreachable. Locally (or in any CI job with a live Postgres) it does a real
# round-trip against a throwaway database: seeds synthetic snapshot rows for two
# branches directly via psql (bypassing the Express middleware, which is covered by its
# own Vitest suite), then exercises contract-diff.sh end-to-end.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/contract-diff.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/contract-snapshots.sql"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_nonzero()  { if [ "$2" -ne 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected non-zero exit, got 0"; FAIL=1; fi; }
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }

# Hard safety rail: LAB_DATABASE_URL resolving to a real app database must be refused
# loudly, before any DB connection is attempted — no live Postgres needed for this
# assertion, the guard is a pure string check that runs before the first psql call.
DIFF_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$SCRIPT" feature main 2>&1 1>/dev/null); DIFF_RC=$?
assert_nonzero "contract-diff.sh refuses LAB_DATABASE_URL=nutricam" "$DIFF_RC"
assert_contains "contract-diff.sh refusal names nutricam" "$DIFF_ERR" "nutricam"

# Regression: a query string must not mask the database name and bypass the denylist
# (a naive `${LAB_DATABASE_URL##*/}` alone would slice to "nutricam?sslmode=require",
# which fails an exact-string "== nutricam" check).
QS_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$SCRIPT" feature main 2>&1 1>/dev/null); QS_RC=$?
assert_nonzero "contract-diff.sh refuses nutricam even with a query string appended" "$QS_RC"
assert_contains "contract-diff.sh refusal (query string form) names nutricam" "$QS_ERR" "nutricam"

# Fragment-suffix regression. Note this is NOT the same silent-bypass mechanism as the
# query-string case above: libpq treats `#` as a literal dbname character, not a URI
# fragment delimiter, so a pre-fix `nutricam#anchor` already fails LOUDLY (psql errors on a
# database literally named "nutricam#anchor" — verified live) rather than silently
# connecting to the real nutricam. Stripping the fragment here is a harmless robustness
# addition, not the closure of a live silent-bypass hole the way the query-string strip is.
# Assert on the distinctive denylist message, not merely "nutricam" — without the fragment
# strip, "nutricam#anchor" falls through the exact-match case (it isn't literally
# "nutricam") to the identifier-format check below, which also refuses it but with a
# different message ("is not a safe Postgres identifier") — a weaker assertion would pass
# for the wrong reason on the unfixed script.
FRAG_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam#anchor" bash "$SCRIPT" feature main 2>&1 1>/dev/null); FRAG_RC=$?
assert_nonzero "contract-diff.sh refuses nutricam+fragment" "$FRAG_RC"
assert_contains "fragment refusal names nutricam" "$FRAG_ERR" "nutricam"
assert_contains "fragment refusal is the denylist rail, not a downstream error" "$FRAG_ERR" "a real app database, not a PG Lab database"

# Identifier-injection guard, mirroring init.sh's stricter check.
LAB_DATABASE_URL='postgresql://localhost/foo"; DROP TABLE x; --' bash "$SCRIPT" feature main >/dev/null 2>&1
assert_nonzero "contract-diff.sh refuses a database name that isn't a safe identifier" "$?"

# Regression: a percent-encoded "nutricam" (which a real Postgres connection would
# decode to the literal database "nutricam") must still be refused -- caught here by
# the identifier-regex check (the "%" survives into DB_NAME, which the regex rejects),
# not by the exact-string denylist itself.
LAB_DATABASE_URL="postgresql://localhost/nutr%69cam" bash "$SCRIPT" feature main >/dev/null 2>&1
assert_nonzero "contract-diff.sh refuses a percent-encoded nutricam path segment" "$?"

# Missing required <branch> argument must fail loudly with a usage message.
USAGE_ERR=$(bash "$SCRIPT" 2>&1 1>/dev/null); USAGE_RC=$?
assert_nonzero "contract-diff.sh refuses a missing <branch> argument" "$USAGE_RC"
assert_contains "contract-diff.sh prints a usage message" "$USAGE_ERR" "usage:"

# The rest needs a live local Postgres to create a throwaway test DB. Skip (not fail)
# when there is none.
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

TEST_DB="pg_lab_contract_diff_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1
}
trap cleanup EXIT

LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
assert_exit0 "init.sh creates the throwaway DB" "$?"

psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "contract-snapshots.sql applies cleanly" "$?"

seed_row() {
  local branch="$1" route="$2" method="$3" status="$4" shape="$5"
  psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" \
    -v branch="$branch" -v route="$route" -v method="$method" -v shape="$shape" \
    <<SQL >/dev/null 2>&1
INSERT INTO dev.contract_snapshots (branch, route_pattern, method, status, shape, sample_count)
VALUES (:'branch', :'route', :'method', $status, :'shape'::jsonb, 1);
SQL
}

# Identical shapes on both branches for one route -- must report no diff.
STABLE_SHAPE='{"type":"object","keys":{"id":{"type":"number"}}}'
seed_row main "/api/stable" GET 200 "$STABLE_SHAPE"
seed_row feature "/api/stable" GET 200 "$STABLE_SHAPE"

# A route only on the feature branch -- added route.
seed_row feature "/api/new-thing" POST 201 '{"type":"object","keys":{"ok":{"type":"boolean"}}}'

# A route only on main -- removed route.
seed_row main "/api/gone" DELETE 200 '{"type":"null"}'

# Same route on both branches, but a key was added and another retyped on feature.
BASE_SHAPE='{"type":"object","keys":{"count":{"type":"number"},"label":{"type":"string"}}}'
FEATURE_SHAPE='{"type":"object","keys":{"count":{"type":"string"},"extra":{"type":"boolean"},"label":{"type":"string"}}}'
seed_row main "/api/changed" GET 200 "$BASE_SHAPE"
seed_row feature "/api/changed" GET 200 "$FEATURE_SHAPE"

OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" feature main); RC=$?
assert_nonzero "contract-diff.sh exits non-zero when differences exist" "$RC"
assert_contains "reports the added route" "$OUT" "POST /api/new-thing"
assert_contains "reports the removed route" "$OUT" "DELETE /api/gone"
assert_contains "reports the added key" "$OUT" "+ extra"
assert_contains "reports the retyped key" "$OUT" "~ count"
assert_contains "prints per-branch sample counts" "$OUT" "SAMPLES:"

# Comparing a branch against itself (only the stable route) must report no differences.
STABLE_ONLY_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" main main); STABLE_RC=$?
assert_exit0 "no differences when comparing identical stable-only data" "$STABLE_RC"
assert_contains "prints 'no differences' when there are none" "$STABLE_ONLY_OUT" "no differences"

# A base branch with zero recorded traffic must be reported as "no data", not silently
# treated as "no differences" (the todo's Risks section).
EMPTY_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" feature does-not-exist-branch); EMPTY_RC=$?
assert_nonzero "zero-sample base branch is reported as a difference (added routes), not silently 'no diff'" "$EMPTY_RC"
assert_contains "zero-sample base is flagged as zero recorded traffic" "$EMPTY_OUT" "zero recorded traffic"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
