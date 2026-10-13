#!/bin/bash
# SessionStart hook: prepares a Claude Code cloud session (claude.ai/code) so the vitest
# suite (which needs a live PostgreSQL) and the linters can run. No-op everywhere else.
#
# Mirrors CI's test job (.github/workflows/ci.yml) — same DB identity, same pg_trgm
# extension, same `npm ci` + `db:push` — because that is the only setup proven to run
# the suite. Each variable below is defaulted ONLY when the cloud environment hasn't set
# it, and is persisted for the session via CLAUDE_ENV_FILE. The defaults are CI's stubs,
# not secrets; real keys belong in the environment's network secrets.
#
# Re-runnable: SessionStart also fires on resume and after a compaction, so `npm ci`
# only runs when package-lock.json changed since the last install. Only the
# environment's setup-script snapshot persists between sessions — put `npm ci` in the
# setup script so a fresh session starts with node_modules and this hook skips it.
#
# Fails open: any failed step prints one line naming the log and exits 0. All command
# output goes to the log, never stdout — stdout is injected into the session's context.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

LOG="${TMPDIR:-/tmp}/ocrecipes-session-start.log"
: > "$LOG" 2>/dev/null || LOG=/dev/null

fail() { echo "session-start: cloud setup failed at '$1' — see $LOG"; exit 0; }
# step <label> <cmd...> — stdin from /dev/null so a prompting command errors instead
# of hanging the session until the hook's timeout.
step() { local label="$1"; shift; "$@" >>"$LOG" 2>&1 </dev/null || fail "$label"; }

default_env() {
  local name="$1" value="$2"
  [ -n "${!name:-}" ] && return 0
  export "$name=$value"
  if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -q "^export $name=" "$CLAUDE_ENV_FILE" 2>/dev/null; then
    echo "export $name=$value" >> "$CLAUDE_ENV_FILE"
  fi
}

# 1. Environment — CI's values (ci.yml test job `env:`).
default_env DATABASE_URL "postgresql://ocrecipes:ocrecipes@localhost:5432/ocrecipes_test"
default_env JWT_SECRET "ci-test-jwt-secret-minimum-32-chars-long"
default_env LOG_LEVEL "silent"
default_env AI_INTEGRATIONS_OPENAI_API_KEY "sk-stub"
default_env USDA_API_KEY "stub"
default_env API_NINJAS_KEY "stub"
default_env RECEIPT_VALIDATION_STUB "true"

# 2. Node dependencies — only when the lockfile changed since the last install.
STAMP="node_modules/.ocrecipes-lockfile-stamp"
deps="cached"
if [ ! -d node_modules ] || ! cmp -s package-lock.json "$STAMP"; then
  step "npm ci" npm ci --no-audit --no-fund
  mkdir -p node_modules && cp package-lock.json "$STAMP"
  deps="installed"
fi

# 3. PostgreSQL 16 (preinstalled in the cloud image, not running by default).
step "start postgres" service postgresql start
ready=""
for _ in $(seq 1 30); do
  if pg_isready -q >>"$LOG" 2>&1; then ready=1; break; fi
  sleep 1
done
[ -n "$ready" ] || fail "postgres readiness"

# 4. CI's role + database, created once.
role=$(su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='ocrecipes'\"" 2>>"$LOG") || role=""
[ "$role" = "1" ] || step "create role" \
  su postgres -c "psql -c \"CREATE ROLE ocrecipes SUPERUSER LOGIN PASSWORD 'ocrecipes'\""
db=$(su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='ocrecipes_test'\"" 2>>"$LOG") || db=""
[ "$db" = "1" ] || step "create database" su postgres -c "createdb -O ocrecipes ocrecipes_test"

# 5. Extension + schema, exactly as CI does it.
step "pg_trgm" psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
step "db:push" npm run db:push

node_v=$(node --version 2>/dev/null) || node_v="none"
warn=""
case "$node_v" in v24.*) ;; *) warn=" — WARNING: node $node_v, package.json wants 24.x" ;; esac
echo "session-start: cloud setup ready (Postgres ocrecipes_test, deps $deps, node $node_v)$warn — log: $LOG"
