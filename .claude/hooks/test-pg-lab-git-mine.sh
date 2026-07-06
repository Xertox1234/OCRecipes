#!/usr/bin/env bash
# Unit test for scripts/pg-lab/git-mine.sh (and, incidentally,
# scripts/pg-lab/schema/git-mining.sql — the round-trip below applies it through the
# script). Run by CI (Lint · Types · Patterns job) via scripts/run-hook-tests.sh's
# `.claude/hooks/test-*.sh` glob.
#
# That job has NO postgres service (only the Tests/Coverage jobs do — see
# .github/workflows/ci.yml), so this test must SKIP cleanly, never fail, when Postgres is
# unreachable. It never shells out to real git — the synthetic fixture below is fed
# straight through the PG_LAB_GIT_LOG_RAW test seam (mirrors PG_LAB_SOLUTIONS_DIR in
# test-pg-lab-codify-neardup.sh), so it is a real --rebuild/--import/hotspots/coupled
# round-trip against a throwaway database with NO dependency on this repo's actual history.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/git-mine.sh"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_nonzero()  { if [ "$2" -ne 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected non-zero exit, got 0"; FAIL=1; fi; }
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_not_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "FAIL: $1 — unexpectedly contains: $3"; FAIL=1; else echo "ok: $1"; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }

# Fail-closed safety rail: LAB_DATABASE_URL resolving to a real app database must be
# refused loudly, before any DB connection is attempted — no live Postgres needed.
REFUSE_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$SCRIPT" hotspots 2>&1 1>/dev/null); REFUSE_RC=$?
assert_nonzero "git-mine.sh refuses LAB_DATABASE_URL=nutricam" "$REFUSE_RC"
assert_contains "refusal names nutricam" "$REFUSE_ERR" "nutricam"

# Query-string-smuggling regression (docs/solutions/logic-errors/
# denylist-bypassed-by-connection-string-query-string-2026-07-06.md): a raw `${VAR##*/}`
# split lets `nutricam?sslmode=require` sail past the denylist while psql still connects
# to the real database.
REFUSE_QS_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require" bash "$SCRIPT" hotspots 2>&1 1>/dev/null); REFUSE_QS_RC=$?
assert_nonzero "git-mine.sh refuses nutricam+query-string" "$REFUSE_QS_RC"
assert_contains "query-string refusal names nutricam" "$REFUSE_QS_ERR" "nutricam"

# The rest needs a live local Postgres to create a throwaway test DB. Skip (not fail) when
# there is none.
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

TEST_DB="pg_lab_git_mine_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
FIX=""
EMPTY_FIX=""
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1
  [ -z "$FIX" ] || rm -f "$FIX"
  [ -z "$EMPTY_FIX" ] || rm -f "$EMPTY_FIX"
}
trap cleanup EXIT

psql -X -q -d postgres -c "CREATE DATABASE \"$TEST_DB\"" >/dev/null 2>&1
assert_exit0 "throwaway test DB created" "$?"

# Synthetic history fed through PG_LAB_GIT_LOG_RAW — no real git call. Uses REAL paths
# that exist in this checkout (shared/schema.ts, package.json, package-lock.json,
# docs/solutions/README.md) so the hotspots "filtered to existing files" check has
# something true to filter FOR, plus one deliberately-fake path to prove it filters
# something out too. Commits are authored newest-first (c1 first), matching real
# `git log`'s default order — git-mine.sh relies on that order to pick the cursor sha.
RS=$'\x02'
FS=$'\x01'
FIX=$(mktemp)
{
  printf '%s' "$RS"; printf 'c1%s2026-01-06T00:00:00-08:00%sAlice%sTouch schema and package.json\n' "$FS" "$FS" "$FS"
  printf '5\t0\tshared/schema.ts\n3\t0\tpackage.json\n'
  printf '%s' "$RS"; printf 'c2%s2026-01-05T00:00:00-08:00%sBob%sTouch schema and package.json again\n' "$FS" "$FS" "$FS"
  printf '2\t1\tshared/schema.ts\n2\t0\tpackage.json\n'
  printf '%s' "$RS"; printf 'c3%s2026-01-04T00:00:00-08:00%sAlice%sTouch schema and the lockfile\n' "$FS" "$FS" "$FS"
  printf '1\t0\tshared/schema.ts\n50\t50\tpackage-lock.json\n'
  printf '%s' "$RS"; printf 'c4%s2026-01-03T00:00:00-08:00%sBob%sUnrelated docs edit\n' "$FS" "$FS" "$FS"
  printf '1\t1\tdocs/solutions/README.md\n'
  printf '%s' "$RS"; printf 'c5%s2026-01-02T00:00:00-08:00%sAlice%sBinary asset commit\n' "$FS" "$FS" "$FS"
  printf -- '-\t-\tassets/fixture-binary-test.bin\n'
  printf '%s' "$RS"; printf 'c6%s2026-01-01T00:00:00-08:00%sBob%sFake huge-churn file that must not exist on disk\n' "$FS" "$FS" "$FS"
  printf '999\t999\tclient/totally-fake-file-for-test-fixture.ts\n'
} > "$FIX"

REBUILD_OUT=$(LAB_DATABASE_URL="$TEST_URL" PG_LAB_GIT_LOG_RAW="$FIX" bash "$SCRIPT" --rebuild); REBUILD_RC=$?
assert_exit0 "--rebuild against synthetic fixture" "$REBUILD_RC"
assert_contains "--rebuild reports imported count" "$REBUILD_OUT" "imported 6 commit(s)"
assert_contains "--rebuild cursor is the newest (first-listed) commit" "$REBUILD_OUT" "cursor at c1"

COMMIT_COUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM repo.commits")
assert_eq "--rebuild loads exactly 6 commits" "$COMMIT_COUNT" "6"

CHANGE_COUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM repo.file_changes")
assert_eq "--rebuild loads exactly 9 file_changes rows" "$CHANGE_COUNT" "9"

BINARY_ROW=$(psql -X -q -tA -F',' -d "$TEST_URL" -c "SELECT additions, deletions, is_binary FROM repo.file_changes WHERE path = 'assets/fixture-binary-test.bin'")
assert_eq "binary numstat '-'/'-' stored as 0/0" "$BINARY_ROW" "0,0,t"

CURSOR_SHA=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT last_sha FROM repo.import_cursor WHERE id")
assert_eq "import_cursor points at the newest commit" "$CURSOR_SHA" "c1"

# hotspots: shared/schema.ts (3 commits, churn 9 = 5+0+2+1+1+0, score 27) must rank first. The lockfile
# (huge raw churn, would rank #1 unfiltered) and the fake nonexistent path (huge raw churn)
# must both be absent — proving the exclusion-list filter and the existing-files filter
# independently, since only ONE of those two reasons excludes each path.
HOTSPOTS_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" hotspots); HOTSPOTS_RC=$?
assert_exit0 "hotspots exits 0" "$HOTSPOTS_RC"
assert_contains "hotspots ranks shared/schema.ts first" "$(printf '%s\n' "$HOTSPOTS_OUT" | head -n1)" "shared/schema.ts"
assert_not_contains "hotspots excludes package-lock.json (generated-file list)" "$HOTSPOTS_OUT" "package-lock.json"
assert_not_contains "hotspots excludes a path that doesn't exist on disk" "$HOTSPOTS_OUT" "totally-fake-file-for-test-fixture"

# coupled: package.json co-changes with shared/schema.ts in 2 of its 3 commits (66.7%
# confidence). package-lock.json co-changes too (1 of 3 commits) and would qualify at
# --min-support 1, but must be excluded by the same generated-file list.
COUPLED_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" coupled shared/schema.ts --min-support 1); COUPLED_RC=$?
assert_exit0 "coupled exits 0" "$COUPLED_RC"
assert_contains "coupled finds package.json" "$COUPLED_OUT" "package.json"
assert_contains "coupled reports 66.7% confidence for package.json" "$COUPLED_OUT" "66.7"
assert_not_contains "coupled excludes package-lock.json despite qualifying support" "$COUPLED_OUT" "package-lock.json"

# Regression test for a CRITICAL finding from code review: --min-support is spliced into
# the query as an unquoted psql `:minsup` substitution — a non-integer value like
# "0 OR 1=1" used to rewrite the WHERE clause and bypass the filter entirely (verified
# experimentally before the fix). Must now be rejected before it ever reaches psql.
INJECT_ERR=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" coupled shared/schema.ts --min-support "0 OR 1=1" 2>&1 1>/dev/null); INJECT_RC=$?
assert_nonzero "coupled rejects a non-integer --min-support (injection guard)" "$INJECT_RC"
assert_contains "rejection names the bad value" "$INJECT_ERR" "non-negative integer"

# Regression test for a WARNING finding from code review: a bare trailing flag with no
# value must error immediately, not spin forever (shift 2 is a no-op when only one
# positional param remains). No `timeout` wrapper — it's not installed on macOS by
# default (no coreutils) and the fixed guard exits before the loop can spin, so a
# regression would hang this whole test file rather than silently pass; that's an
# acceptable, self-evident failure mode for a dev-tool test.
LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" hotspots --since >/dev/null 2>&1
assert_nonzero "hotspots --since with no value exits promptly (not a hang)" "$?"
LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" coupled shared/schema.ts --min-support >/dev/null 2>&1
assert_nonzero "coupled --min-support with no value exits promptly (not a hang)" "$?"

# --import replaying the identical fixture must be idempotent (ON CONFLICT DO NOTHING) —
# no duplicate rows.
IMPORT_OUT=$(LAB_DATABASE_URL="$TEST_URL" PG_LAB_GIT_LOG_RAW="$FIX" bash "$SCRIPT" --import); IMPORT_RC=$?
assert_exit0 "--import replay exits 0" "$IMPORT_RC"
assert_contains "--import replay reports the same 6 commits parsed" "$IMPORT_OUT" "imported 6 commit(s)"
POST_IMPORT_COMMITS=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM repo.commits")
assert_eq "--import replay does not duplicate commits" "$POST_IMPORT_COMMITS" "6"
POST_IMPORT_CHANGES=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM repo.file_changes")
assert_eq "--import replay does not duplicate file_changes" "$POST_IMPORT_CHANGES" "9"

# The replay above proves idempotency but — since PG_LAB_GIT_LOG_RAW always emits the
# same fixture text regardless of range — never proves do_import's cursor-based range
# STRING is built correctly. Assert it directly via the PG_LAB_GIT_MINE_DEBUG_RANGE_FILE
# side channel (test-only; git_log_source writes the range it WOULD have passed to git).
RANGE_DEBUG=$(mktemp)
LAB_DATABASE_URL="$TEST_URL" PG_LAB_GIT_LOG_RAW="$FIX" PG_LAB_GIT_MINE_DEBUG_RANGE_FILE="$RANGE_DEBUG" bash "$SCRIPT" --import >/dev/null
RANGE_SEEN=$(cat "$RANGE_DEBUG")
rm -f "$RANGE_DEBUG"
assert_eq "--import computes the range from the stored cursor (c1..HEAD)" "$RANGE_SEEN" "c1..HEAD"

# --rebuild on an empty/zero-commit fixture must fail loudly (count-and-fail-on-zero)
# rather than silently truncating the table.
EMPTY_FIX=$(mktemp)
LAB_DATABASE_URL="$TEST_URL" PG_LAB_GIT_LOG_RAW="$EMPTY_FIX" bash "$SCRIPT" --rebuild >/dev/null 2>&1
assert_nonzero "--rebuild on a zero-commit fixture fails loudly" "$?"
POST_EMPTY_COMMITS=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM repo.commits")
assert_eq "table untouched after a refused empty-fixture rebuild" "$POST_EMPTY_COMMITS" "6"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
