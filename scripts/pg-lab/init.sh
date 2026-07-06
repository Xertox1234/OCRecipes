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

# Simplifying assumption: a plain postgresql://host[:port]/dbname URL, optionally with a
# query string / fragment. This is a local-dev-only tool (never prod) and every documented
# LAB_DATABASE_URL usage in this repo is of that shape, so plain string surgery to swap
# the path segment for the "postgres" maintenance DB is sufficient — no URL parser needed.
# Strip query string / fragment BEFORE deriving DB_NAME — a raw `${VAR##*/}` split alone
# lets a suffix like `?sslmode=require` smuggle a denylisted name (e.g.
# `nutricam?sslmode=require`) past the `case` match below entirely, while `psql` itself
# parses the full URI correctly and connects to the real database anyway.
LAB_DB_PATH="${LAB_DATABASE_URL%%\?*}"
LAB_DB_PATH="${LAB_DB_PATH%%\#*}"
DB_NAME="${LAB_DB_PATH##*/}"
MAINT_URL="${LAB_DB_PATH%/*}/postgres"

# Hard safety rail: this script must never create/touch a real app database, and
# DB_NAME is interpolated directly into SQL text below (psql -c has no bind-param
# support for identifiers) — so it must also be a safe bare identifier, never a
# quote-breaking string. Denylist (not an allowlist) so it doesn't constrain future
# ocrecipes_lab-family naming (e.g. the test fixture's pg_lab_codify_neardup_test_$$).
case "$DB_NAME" in
  nutricam | ocrecipes_solutions)
    echo "init.sh: refusing — LAB_DATABASE_URL resolves to '$DB_NAME', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac
if ! [[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "init.sh: refusing — '$DB_NAME' (derived from LAB_DATABASE_URL) is not a safe Postgres identifier" >&2
  exit 1
fi

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
