#!/bin/bash
# SessionStart hook: prepares a Claude Code on the web container so the
# vitest suite (which needs a live PostgreSQL) and linters can run.
#
# Idempotent — safe to re-run. Only does work in remote (web) sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# 1. Node dependencies (cached across sessions once the hook completes).
npm install --no-audit --no-fund

# 2. Start the PostgreSQL 16 cluster the test suite expects on :5432.
service postgresql start
for _ in $(seq 1 30); do
  pg_isready -q && break
  sleep 1
done

# 3. Allow passwordless localhost connections (test DATABASE_URL has no
#    credentials). sed is a no-op if already set to trust.
HBA="/etc/postgresql/16/main/pg_hba.conf"
if [ -f "$HBA" ]; then
  sed -i -E 's#^(host[[:space:]]+all[[:space:]]+all[[:space:]]+(127\.0\.0\.1/32|::1/128)[[:space:]]+)scram-sha-256#\1trust#' "$HBA"
  service postgresql reload
fi

# 4. Create the role + database referenced by DATABASE_URL (postgres://localhost/nutricam).
su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='root'\"" | grep -q 1 \
  || su postgres -c "psql -c \"CREATE ROLE root SUPERUSER LOGIN\""
su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='nutricam'\"" | grep -q 1 \
  || su postgres -c "createdb -O root nutricam"

# 5. Extensions required by the Drizzle schema.
psql -U root -h 127.0.0.1 -d nutricam -c \
  "CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";
   CREATE EXTENSION IF NOT EXISTS unaccent;"

# 6. The 'pg' driver needs an explicit user since DATABASE_URL omits one.
#    Persist PGUSER for the session and use it for the schema push.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PGUSER=root' >> "$CLAUDE_ENV_FILE"
fi
export PGUSER=root

# 7. Apply the Drizzle schema to the fresh database.
npm run db:push
