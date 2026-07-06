#!/usr/bin/env bash
# scripts/pg-lab/init.sh — bootstrap the ocrecipes_lab local Postgres database.
#
# ocrecipes_lab is the shared home for ALL PG Lab items (docs/research/2026-07-05-pg-lab-roadmap.md).
# It is NEVER a source of truth: every table under it is either an append-only event
# ledger or a derived projection rebuildable from its source via a --rebuild script — see
# design rail §1 in the roadmap doc. It is a separate database from `nutricam` (the
# app/Vitest dev DB) and from `ocrecipes_solutions` (the retired solutions-DB, PR #491).
#
# Idempotent: safe to re-run. Creates the database if absent, enables pg_trgm, and creates
# the three per-domain schemas every PG Lab item lives under:
#   harness — telemetry, transcripts, injection
#   repo    — git mining, symbol graph
#   dev     — API cache, contract snapshots, eval scores, flake ledger
#
# Respects LAB_DATABASE_URL (default: postgresql://localhost/ocrecipes_lab).
#
# Usage: scripts/pg-lab/init.sh
set -euo pipefail

LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"

# Simplifying assumption: a plain postgresql://host[:port]/dbname URL with no query
# string. This is a local-dev-only tool (never prod) and every documented
# LAB_DATABASE_URL usage in this repo is of that shape, so plain string surgery to swap
# the path segment for the "postgres" maintenance DB is sufficient — no URL parser needed.
DB_NAME="${LAB_DATABASE_URL##*/}"
MAINT_URL="${LAB_DATABASE_URL%/*}/postgres"

EXISTS="$(psql -X -q -tA -v ON_ERROR_STOP=1 -d "$MAINT_URL" \
  -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")"

if [ "$EXISTS" != "1" ]; then
  echo "▶ creating database $DB_NAME"
  # Tolerate a benign TOCTOU race (another concurrent init.sh run created it between the
  # existence check above and this CREATE) — anything else still fails loudly.
  CREATE_ERR="$(psql -X -q -v ON_ERROR_STOP=1 -d "$MAINT_URL" -c "CREATE DATABASE \"$DB_NAME\"" 2>&1)" || {
    if printf '%s' "$CREATE_ERR" | grep -qi "already exists"; then
      echo "▶ database $DB_NAME already exists (created concurrently)"
    else
      echo "$CREATE_ERR" >&2
      exit 1
    fi
  }
else
  echo "▶ database $DB_NAME already exists"
fi

psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS harness;
CREATE SCHEMA IF NOT EXISTS repo;
CREATE SCHEMA IF NOT EXISTS dev;
SQL

echo "✓ ocrecipes_lab ready: $LAB_DATABASE_URL (extension pg_trgm, schemas harness/repo/dev)"
