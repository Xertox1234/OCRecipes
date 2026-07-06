#!/usr/bin/env bash
# scripts/pg-lab/flake-report.sh — retry-consumption ranking and duration trend for
# dev.test_runs (PG Lab Batch B — see scripts/pg-lab/schema/flake-ledger.sql and
# scripts/pg-lab/vitest-flake-reporter.ts).
#
# Two modes:
#   (no args)              Top retry-consuming tests over the trailing N days (default
#                           30; override with FLAKE_REPORT_DAYS).
#   "<test full name>"      Duration trend for one named test, most recent runs first.
#
# NOTE on the parent todo's stated default ("the itest-defer api-test"): that test is
# `.claude/hooks/test-inject-patterns.sh`'s `itest-defer` case — a bash-level hook test
# entirely outside Vitest, so vitest-flake-reporter.ts can never populate a row for it.
# There is deliberately NO hardcoded default test name here; pass a real Vitest test's
# `fullName` (as it appears in dev.test_runs.test_name) to use the trend mode. See
# todos/archive/P3-2026-07-05-pg-flake-ledger.md Updates for the full note.
#
# This is a human-invoked reporting tool (unlike the fail-silent writer in
# vitest-flake-reporter.ts) — it fails LOUDLY if psql is missing or the DB is unreachable.
# It also applies its own schema defensively (idempotent CREATE ... IF NOT EXISTS) before
# querying, matching the eval-report.sh / codify-neardup.sh --rebuild precedent, so the
# report works even before any local test run has ever successfully persisted a row.
#
# Respects LAB_DATABASE_URL (default: postgresql://localhost/ocrecipes_lab).
#
# Usage:
#   scripts/pg-lab/flake-report.sh                              # top retry-consuming tests
#   scripts/pg-lab/flake-report.sh "some test full name"        # duration trend
#   FLAKE_REPORT_DAYS=7 scripts/pg-lab/flake-report.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
DAYS="${FLAKE_REPORT_DAYS:-30}"
TEST_NAME="${1:-}"

# Hard safety rail: never run against a real app database (matches init.sh /
# codify-neardup.sh / eval-report.sh). Strip any query string / fragment BEFORE the
# last-path-segment split — a raw `${VAR##*/}` split alone lets a suffix like
# `?sslmode=require` smuggle a denylisted name (e.g. `nutricam?sslmode=require`) past the
# `case` match entirely, while `psql` itself parses the full URI correctly and connects to
# the real database anyway. Mirrors the `new URL(connectionString).pathname` parsing
# vitest-flake-reporter.ts uses for the same check.
LAB_DB_PATH="${LAB_DATABASE_URL%%\?*}"
LAB_DB_PATH="${LAB_DB_PATH%%\#*}"
case "${LAB_DB_PATH##*/}" in
  nutricam | ocrecipes_solutions)
    echo "flake-report.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DB_PATH##*/}', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac

if ! command -v psql >/dev/null 2>&1; then
  echo "flake-report.sh: psql not found on PATH" >&2
  exit 1
fi

if ! [[ "$DAYS" =~ ^[0-9]+$ ]]; then
  echo "flake-report.sh: FLAKE_REPORT_DAYS must be a non-negative integer (got '$DAYS')" >&2
  exit 1
fi

# client_min_messages=warning: the idempotent IF NOT EXISTS schema raises benign
# "already exists, skipping" NOTICEs on every re-apply; suppress those without hiding a
# genuine WARNING/ERROR (which would still abort the script via ON_ERROR_STOP + set -e).
PGOPTIONS='-c client_min_messages=warning' \
  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -f "$SCRIPT_DIR/schema/flake-ledger.sql" >/dev/null

if [ -n "$TEST_NAME" ]; then
  # Duration-trend mode. TEST_NAME is arbitrary (a test's fullName can contain quotes,
  # colons, parens, unicode) so it is passed through psql's own -v mechanism and
  # substituted with :'tname' from a QUOTED heredoc (bash performs no substitution here;
  # psql's :'var' form does its own safe SQL-string escaping) — never -c, whose argument
  # bypasses psql's variable-substitution pass entirely (see docs/solutions/logic-errors/
  # psql-c-flag-skips-var-substitution-2026-07-05.md).
  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v tname="$TEST_NAME" <<'SQL'
SELECT ts, commit, round(duration_ms::numeric, 1) AS duration_ms, retry_count, flaky, state
FROM dev.test_runs
WHERE test_name = :'tname'
ORDER BY ts DESC
LIMIT 50;
SQL
else
  # Default mode: top retry-consuming tests over the trailing N days. DAYS is regex-
  # validated above (digits only), so bash-interpolating it into this unquoted heredoc
  # (mirroring eval-report.sh's own validated $THRESHOLD/$WHERE_CLAUSE) is safe.
  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" <<SQL
SELECT test_name, file,
       count(*) FILTER (WHERE retry_count > 0) AS runs_with_retries,
       sum(retry_count) AS total_retries,
       count(*) FILTER (WHERE flaky) AS flaky_passes,
       count(*) AS total_runs
FROM dev.test_runs
WHERE ts >= now() - interval '$DAYS days'
GROUP BY test_name, file
HAVING sum(retry_count) > 0
ORDER BY total_retries DESC, runs_with_retries DESC
LIMIT 20;
SQL
fi
