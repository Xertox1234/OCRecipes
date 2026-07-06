#!/usr/bin/env bash
# scripts/pg-lab/eval-report.sh — score trend per case/service across commits for
# dev.eval_results (PG Lab Batch B — see scripts/pg-lab/schema/eval-results.sql and
# evals/lib/eval-results-store.ts).
#
# For each (service, case_id) pair, reports the most recent commit's average score
# against the trailing mean of its prior commits (up to 5), and flags a REGRESSION when
# the drop is >= EVAL_REPORT_THRESHOLD (default 1.0, on the judge's 1-10 scale).
#
# This is a human-invoked reporting tool (unlike the fail-silent writer in
# evals/lib/eval-results-store.ts) — it fails LOUDLY if psql is missing or the DB is
# unreachable, since a human running it directly wants to see why it didn't work. It also
# applies its own schema defensively (idempotent CREATE ... IF NOT EXISTS) before querying,
# matching the scripts/pg-lab/codify-neardup.sh --rebuild precedent, so the report works
# even before any eval run has ever successfully persisted a row.
#
# Respects LAB_DATABASE_URL (default: postgresql://localhost/ocrecipes_lab).
#
# Usage:
#   scripts/pg-lab/eval-report.sh                    # all services
#   scripts/pg-lab/eval-report.sh coach              # filter to one service
#   EVAL_REPORT_THRESHOLD=2.0 scripts/pg-lab/eval-report.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
THRESHOLD="${EVAL_REPORT_THRESHOLD:-1.0}"
SERVICE_FILTER="${1:-}"

# Hard safety rail: never run against a real app database (matches init.sh / codify-neardup.sh).
# Strip query string / fragment BEFORE the last-path-segment split — a raw `${VAR##*/}`
# split alone lets a suffix like `?sslmode=require` smuggle a denylisted name (e.g.
# `nutricam?sslmode=require`) past the `case` match entirely, while `psql` itself parses
# the full URI correctly and connects to the real database anyway.
LAB_DB_PATH="${LAB_DATABASE_URL%%\?*}"
LAB_DB_PATH="${LAB_DB_PATH%%\#*}"
case "${LAB_DB_PATH##*/}" in
  nutricam | ocrecipes_solutions)
    echo "eval-report.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DB_PATH##*/}', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac

if ! command -v psql >/dev/null 2>&1; then
  echo "eval-report.sh: psql not found on PATH" >&2
  exit 1
fi

if [ -n "$SERVICE_FILTER" ] && ! [[ "$SERVICE_FILTER" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "eval-report.sh: invalid service filter '$SERVICE_FILTER' (expected alphanumeric/dash/underscore)" >&2
  exit 1
fi

if ! [[ "$THRESHOLD" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "eval-report.sh: EVAL_REPORT_THRESHOLD must be a non-negative number (got '$THRESHOLD')" >&2
  exit 1
fi

# client_min_messages=warning: the idempotent IF NOT EXISTS schema raises benign
# "already exists, skipping" NOTICEs on every re-apply; suppress those without hiding a
# genuine WARNING/ERROR (which would still abort the script via ON_ERROR_STOP + set -e).
PGOPTIONS='-c client_min_messages=warning' \
  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -f "$SCRIPT_DIR/schema/eval-results.sql" >/dev/null

# Deliberately no "score IS NOT NULL" filter here (unlike an earlier version of this
# script) — a commit where every case-sample errored before reaching the judge (score
# NULL on every row) is the single worst outcome this report can show, and filtering
# those rows out of by_commit entirely made that commit vanish silently, letting `rn = 1`
# fall through to a stale prior commit's score with no error surfaced. Nulls are excluded
# only from the AVG via FILTER, and an all-null commit is flagged ALL_ERRORED below
# instead of disappearing.
WHERE_CLAUSE="TRUE"
if [ -n "$SERVICE_FILTER" ]; then
  WHERE_CLAUSE="service = '$SERVICE_FILTER'"
fi

# Unquoted heredoc delimiter (deliberate) so bash substitutes $WHERE_CLAUSE/$THRESHOLD
# before psql sees the text — psql's own :'var' substitution only runs on script/stdin
# input, never on a -c string (docs/solutions/logic-errors/psql-c-flag-skips-var-
# substitution-2026-07-05.md); this script sidesteps that entirely by not using -c or
# :var at all, and interpolating already-validated bash variables instead.
psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" <<SQL
WITH by_commit AS (
  SELECT service, case_id, commit, MAX(ts) AS latest_ts,
         AVG(score) FILTER (WHERE score IS NOT NULL) AS avg_score,
         string_agg(DISTINCT judge_model, ',' ORDER BY judge_model) AS judge_models
  FROM dev.eval_results
  WHERE $WHERE_CLAUSE
  GROUP BY service, case_id, commit
),
trended AS (
  SELECT service, case_id, commit, latest_ts, avg_score, judge_models,
         AVG(avg_score) OVER (
           PARTITION BY service, case_id ORDER BY latest_ts
           ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING
         ) AS trailing_mean,
         ROW_NUMBER() OVER (PARTITION BY service, case_id ORDER BY latest_ts DESC) AS rn
  FROM by_commit
)
SELECT service, case_id, commit, judge_models,
       round(avg_score::numeric, 2) AS score,
       round(trailing_mean::numeric, 2) AS trailing_mean,
       CASE
         WHEN avg_score IS NULL THEN 'ALL_ERRORED'
         WHEN trailing_mean IS NOT NULL AND (trailing_mean - avg_score) >= $THRESHOLD
           THEN 'REGRESSION'
         ELSE ''
       END AS flag
FROM trended
WHERE rn = 1
ORDER BY service, case_id;
SQL
