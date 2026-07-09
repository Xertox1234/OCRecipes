#!/usr/bin/env bash
# scripts/pg-lab/contract-diff.sh — compares a feature branch's recorded API response
# shapes (dev.contract_snapshots, written by the dev-only Express middleware in
# server/lib/contract-snapshot.ts, opt-in via CONTRACT_SNAPSHOT=1) against a base
# branch's (default: main). Reports added/removed routes and added/removed/retyped
# keys per shared route, and always prints per-branch sample counts so "no
# differences" is never confused with "no data recorded for one side" (see the todo's
# Risks section).
#
# This is a manual pre-PR check, run directly by a human -- it is NOT wired into
# preflight. Loud by design: exits 1 on any difference (including "one side has zero
# samples"), exits non-zero on any tooling failure (missing psql, DB unreachable).
#
# Respects LAB_DATABASE_URL (default: postgresql://localhost/ocrecipes_lab).
#
# Usage: scripts/pg-lab/contract-diff.sh <branch> [base=main]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"

# Hard safety rail: this must never read from a real app database. Strip a query
# string/fragment BEFORE extracting the trailing path segment -- a bare `##*/` on
# `postgresql://localhost/nutricam?sslmode=require` would slice to
# `"nutricam?sslmode=require"`, silently bypassing an exact-string denylist check.
# Same denylist + identifier check as init.sh (codify-neardup.sh predates this fix).
DB_NAME="${LAB_DATABASE_URL%%\?*}"
DB_NAME="${DB_NAME%%\#*}"
DB_NAME="${DB_NAME##*/}"
case "$DB_NAME" in
  nutricam | ocrecipes_solutions)
    echo "contract-diff.sh: refusing — LAB_DATABASE_URL resolves to '$DB_NAME', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac
if ! [[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "contract-diff.sh: refusing — '$DB_NAME' (derived from LAB_DATABASE_URL) is not a safe Postgres identifier" >&2
  exit 1
fi

FEATURE_BRANCH="${1:-}"
BASE_BRANCH="${2:-main}"

if [ -z "$FEATURE_BRANCH" ]; then
  echo "usage: $0 <branch> [base=main]" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "contract-diff.sh: psql not found on PATH" >&2
  exit 1
fi

# Fetch every recorded row for one branch as a JSON array. COALESCE guards an
# all-NULL aggregate (zero rows) down to an empty array rather than SQL NULL.
fetch_rows() {
  local branch="$1"
  psql -X -q -tA -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v branch="$branch" <<'SQL'
SELECT COALESCE(
  jsonb_agg(jsonb_build_object(
    'route_pattern', route_pattern,
    'method', method,
    'status', status,
    'shape', shape,
    'sample_count', sample_count
  )),
  '[]'::jsonb
)
FROM dev.contract_snapshots
WHERE branch = :'branch';
SQL
}

FEATURE_ROWS="$(fetch_rows "$FEATURE_BRANCH")"
BASE_ROWS="$(fetch_rows "$BASE_BRANCH")"

INPUT="$(node -e '
  const [base, feature] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({ base: JSON.parse(base), feature: JSON.parse(feature) }));
' "$BASE_ROWS" "$FEATURE_ROWS")"

printf '%s' "$INPUT" | npx tsx "$SCRIPT_DIR/contract-diff-cli.ts"
