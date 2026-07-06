#!/usr/bin/env bash
# scripts/pg-lab/api-cache-report.sh — hit/miss report for the dev-only
# record/replay API cache (server/services/dev-api-cache.ts), backed by
# dev.api_cache / dev.api_cache_log in the ocrecipes_lab lab DB (see
# scripts/pg-lab/schema/api-cache.sql).
#
# This doubles as the value probe for the cache: if the hit rate is
# negligible by 2026-10-01, remove the wrapper (per the todo's Acceptance
# Criteria).
#
# A human runs this directly, so — unlike the fail-silent query path inside
# dev-api-cache.ts itself — it fails LOUDLY on error (psql missing, DB
# unreachable, table missing): silent success would be indistinguishable from
# "no invocations yet" and defeat the point of the report.
#
# First-time setup: this script does NOT apply the schema itself (unlike
# codify-neardup.sh --rebuild). Before first use, apply it once:
#   psql -d ocrecipes_lab -f scripts/pg-lab/schema/api-cache.sql
# ("relation ... does not exist" below means this step hasn't run yet.)
#
# Usage:
#   scripts/pg-lab/api-cache-report.sh [N_DAYS]
#
# N_DAYS defaults to 7. Respects LAB_DATABASE_URL (default:
# postgresql://localhost/ocrecipes_lab).
set -euo pipefail

LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
N_DAYS="${1:-7}"

# Same hard safety rail as init.sh / codify-neardup.sh: never point this at a
# real app database.
case "${LAB_DATABASE_URL##*/}" in
  nutricam | ocrecipes_solutions)
    echo "api-cache-report.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DATABASE_URL##*/}', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac

if ! [[ "$N_DAYS" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 [N_DAYS]  (N_DAYS must be a non-negative integer, got '$N_DAYS')" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "api-cache-report.sh: psql not found on PATH" >&2
  exit 1
fi

echo "▶ dev-api-cache hit/miss report — last ${N_DAYS} day(s), $LAB_DATABASE_URL"
echo

psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v days="$N_DAYS" <<'SQL'
SELECT
    api,
    count(*) FILTER (WHERE hit)     AS hits,
    count(*) FILTER (WHERE NOT hit) AS misses,
    round(
        100.0 * count(*) FILTER (WHERE hit) / NULLIF(count(*), 0),
        1
    ) AS hit_rate_pct
FROM dev.api_cache_log
WHERE ts > now() - (:'days' || ' days')::interval
GROUP BY api
ORDER BY api;
SQL

echo
echo "▶ cached entries per API (all time, dev.api_cache)"
echo

psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" <<'SQL'
SELECT
    api,
    count(*)          AS cached_entries,
    max(recorded_at)  AS most_recently_recorded
FROM dev.api_cache
GROUP BY api
ORDER BY api;
SQL
