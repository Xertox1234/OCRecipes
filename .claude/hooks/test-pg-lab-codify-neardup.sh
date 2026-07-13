#!/usr/bin/env bash
# Unit test for scripts/pg-lab/codify-neardup.sh (and, incidentally, scripts/pg-lab/init.sh
# — the round-trip below creates a throwaway lab DB through it). Run by CI (Lint · Types ·
# Patterns job) via scripts/run-hook-tests.sh's `.claude/hooks/test-*.sh` glob.
#
# That job has NO postgres service (only the Tests/Coverage jobs do — see
# .github/workflows/ci.yml), so this test must SKIP cleanly, never fail, when Postgres is
# unreachable — same fail-silent contract the script itself implements. Locally (or in any
# CI job with a live Postgres) it does a real --rebuild + query round-trip against a
# throwaway database and a fixture corpus, via the PG_LAB_SOLUTIONS_DIR test seam (mirrors
# session-recent-issues.sh's RECENT_SOLUTIONS_DIR).
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/codify-neardup.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_nonzero()  { if [ "$2" -ne 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected non-zero exit, got 0"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $2"; FAIL=1; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }

# Fail-silent contract, part 1: an unreachable/nonexistent lab DB must no-op (empty
# output, exit 0) in query mode. Check this against a definitely-bogus URL before we even
# know whether a local Postgres server is running.
OUT=$(LAB_DATABASE_URL="postgresql://localhost/pg_lab_test_does_not_exist_$$" bash "$SCRIPT" "anything" 2>/dev/null); RC=$?
assert_empty "unreachable DB -> no output" "$OUT"
assert_exit0 "unreachable DB -> exit 0" "$RC"

# Hard safety rail: LAB_DATABASE_URL resolving to a real app database must be refused
# loudly by BOTH scripts, before any DB connection is attempted — no live Postgres needed
# for these assertions, the guard is a pure string check that runs before the first psql call.
NEARDUP_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$SCRIPT" "anything" 2>&1 1>/dev/null); NEARDUP_RC=$?
assert_nonzero "codify-neardup.sh refuses LAB_DATABASE_URL=nutricam" "$NEARDUP_RC"
assert_contains "codify-neardup.sh refusal names nutricam" "$NEARDUP_ERR" "nutricam"

INIT_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$INIT" 2>&1 1>/dev/null); INIT_RC=$?
assert_nonzero "init.sh refuses LAB_DATABASE_URL=nutricam" "$INIT_RC"
assert_contains "init.sh refusal names nutricam" "$INIT_ERR" "nutricam"

# Query-string-smuggling regression: a raw `${VAR##*/}` split (without stripping the query
# string first) lets `nutricam?sslmode=require` sail past the denylist while psql still
# connects to the real `nutricam` database — see docs/solutions/logic-errors/
# denylist-bypassed-by-connection-string-query-string-2026-07-06.md.
NEARDUP_QS_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$SCRIPT" "anything" 2>&1 1>/dev/null); NEARDUP_QS_RC=$?
assert_nonzero "codify-neardup.sh refuses nutricam+query-string" "$NEARDUP_QS_RC"
assert_contains "codify-neardup.sh query-string refusal names nutricam" "$NEARDUP_QS_ERR" "nutricam"

INIT_QS_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$INIT" 2>&1 1>/dev/null); INIT_QS_RC=$?
assert_nonzero "init.sh refuses nutricam+query-string" "$INIT_QS_RC"
assert_contains "init.sh query-string refusal names nutricam" "$INIT_QS_ERR" "nutricam"

# Identifier-injection guard (init.sh derives a bare DB_NAME and interpolates it into SQL
# text via psql -c; codify-neardup.sh never does, it always passes the full URL to -d).
LAB_DATABASE_URL='postgresql://localhost/foo"; DROP TABLE x; --' bash "$INIT" >/dev/null 2>&1
assert_nonzero "init.sh refuses a DB name that isn't a safe identifier" "$?"

# The rest needs a live local Postgres to create a throwaway test DB. Skip (not fail) when
# there is none — mirrors the jq-unavailable skip in test-session-recent-issues.sh.
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

TEST_DB="pg_lab_codify_neardup_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
FIX=""
EMPTY_FIX=""
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE)" >/dev/null 2>&1
  [ -z "$FIX" ] || rm -rf "$FIX"
  [ -z "$EMPTY_FIX" ] || rm -rf "$EMPTY_FIX"
}
trap cleanup EXIT

LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
assert_exit0 "init.sh creates the throwaway DB" "$?"

# Fixture corpus: one solution near a candidate title, one far from it, plus a
# _manifests/ decoy that must be excluded (mirrors mkfix() in test-session-recent-issues.sh).
FIX=$(mktemp -d)
mkfix() {
  local rel="$1" title="$2" body="$3"
  mkdir -p "$FIX/$(dirname "$rel")"
  printf -- "---\ntitle: '%s'\ntrack: knowledge\ncategory: conventions\ntags: [test]\ncreated: '2026-07-05'\n---\n\n# %s\n\n## Rule\n\n%s\n" \
    "$title" "$title" "$body" > "$FIX/$rel"
}
mkfix "conventions/near-2026-07-05.md" \
  "Guard one-shot prod-ops scripts on an explicit flag not NODE_ENV" \
  "A one-shot operational script must gate destructive writes behind an explicit opt-in CLI flag."
mkfix "conventions/far-2026-07-05.md" \
  "Purple elephants juggle recursive teapots on alternating Tuesdays" \
  "This sentence is deliberately unrelated to anything else in the fixture corpus."
mkfix "_manifests/decoy-2026-07-05.md" "Manifest decoy that should never be loaded" "decoy"

REBUILD_OUT=$(LAB_DATABASE_URL="$TEST_URL" PG_LAB_SOLUTIONS_DIR="$FIX" bash "$SCRIPT" --rebuild); REBUILD_RC=$?
assert_exit0 "--rebuild against fixture corpus" "$REBUILD_RC"
assert_contains "--rebuild reports a row count" "$REBUILD_OUT" "rebuilt harness.solution_titles"

ROWCOUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.solution_titles")
assert_eq "--rebuild loads exactly the 2 non-decoy fixtures" "$ROWCOUNT" "2"

# Query round-trip: a near-identical paraphrase of the "near" fixture's title should hit;
# an unrelated candidate should not.
HIT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" "Guard one-shot prod-ops scripts on an explicit flag, not NODE_ENV"); HIT_RC=$?
assert_exit0 "query (hit) exits 0" "$HIT_RC"
assert_contains "query (hit) finds the near fixture" "$HIT" "conventions/near-2026-07-05.md"

MISS=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" "A totally unrelated question about ocean tides and moon phases"); MISS_RC=$?
assert_exit0 "query (miss) exits 0" "$MISS_RC"
assert_empty "query (miss) prints nothing" "$MISS"

# Value probe: both invocations above (hit and miss) must be logged.
LOGCOUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.codify_neardup_log")
if [ "$LOGCOUNT" -ge 2 ]; then
  echo "ok: value-probe log recorded both invocations ($LOGCOUNT rows)"
else
  echo "FAIL: expected >=2 codify_neardup_log rows, got $LOGCOUNT"; FAIL=1
fi

# --rebuild on an empty corpus dir must fail loudly (count-and-fail-on-zero) rather than
# silently truncate the table.
EMPTY_FIX=$(mktemp -d)
LAB_DATABASE_URL="$TEST_URL" PG_LAB_SOLUTIONS_DIR="$EMPTY_FIX" bash "$SCRIPT" --rebuild >/dev/null 2>&1
assert_nonzero "--rebuild on an empty corpus fails loudly" "$?"

POST_EMPTY_ROWCOUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.solution_titles")
assert_eq "table untouched after a refused empty-corpus rebuild" "$POST_EMPTY_ROWCOUNT" "2"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
