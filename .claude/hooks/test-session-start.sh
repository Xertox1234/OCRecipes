#!/usr/bin/env bash
# Unit test for session-start.sh — the cloud-session (claude.ai/code) provisioning hook.
# Run by CI (Lint · Types · Patterns → Hook self-tests). No real Postgres or npm: every
# external command the hook calls is a PATH shim that appends its argv to a log, so the
# test checks WHAT the hook asks for, in what order, and what it exports — on macOS and
# on the Ubuntu runner alike. The hook's DB identity must match CI's (ci.yml test job).
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HOOK_DIR/session-start.sh"
FAIL=0
ok()   { echo "ok: $1"; }
bad()  { echo "FAIL: $1"; FAIL=1; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then ok "$1"; else bad "$1 — missing: $3"; fi; }
assert_absent()   { if grep -qF -- "$3" <<<"$2"; then bad "$1 — unexpectedly present: $3"; else ok "$1"; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — expected '$3', got '$2'"; fi; }

CI_DB_URL="postgresql://ocrecipes:ocrecipes@localhost:5432/ocrecipes_test"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Shims: log "<name> <args>" (db:push also logs the DATABASE_URL it saw, and whether its
# stdin still carries input — a push that can prompt must not be able to wait on the
# session's stdin). run_hook feeds the hook a live stdin, so this is falsifiable even
# where the runner's own stdin is never a terminal.
SHIMS="$TMP/shims"
mkdir -p "$SHIMS"
for cmd in npm service pg_isready su psql createdb; do
  cat > "$SHIMS/$cmd" <<EOF
#!/usr/bin/env bash
if [ "$cmd" = npm ] && [ "\${1:-} \${2:-}" = "run db:push" ]; then
  if IFS= read -r _line; then stdin=live; else stdin=closed; fi
  echo "npm run db:push DATABASE_URL=\${DATABASE_URL:-<unset>} stdin=\$stdin" >> "\$SHIM_LOG"
else
  echo "$cmd \$*" >> "\$SHIM_LOG"
fi
exit 0
EOF
  chmod +x "$SHIMS/$cmd"
done
printf '#!/usr/bin/env bash\necho v24.1.0\n' > "$SHIMS/node"; chmod +x "$SHIMS/node"

# run_hook <case-dir> [extra env assignments...] — fresh project dir per case.
run_hook() {
  local dir="$1"; shift
  mkdir -p "$dir/proj"
  [ -f "$dir/proj/package-lock.json" ] || echo '{"lockfileVersion":3}' > "$dir/proj/package-lock.json"
  : > "$dir/log"
  # Unset every variable the hook defaults: an inherited value (a developer's shell
  # exports real keys) would make the hook rightly skip it and the test fail.
  env -u DATABASE_URL -u JWT_SECRET -u LOG_LEVEL -u AI_INTEGRATIONS_OPENAI_API_KEY \
    -u USDA_API_KEY -u API_NINJAS_KEY -u RECEIPT_VALIDATION_STUB \
    -u CLAUDE_ENV_FILE -u CLAUDE_CODE_REMOTE \
    PATH="$SHIMS:$PATH" SHIM_LOG="$dir/log" CLAUDE_PROJECT_DIR="$dir/proj" "$@" \
    bash "$HOOK" > "$dir/out" 2>&1 <<<"y"
  echo $? > "$dir/rc"
}

# 1. Local session (CLAUDE_CODE_REMOTE unset) → no-op.
C="$TMP/local"; run_hook "$C" CLAUDE_ENV_FILE="$C/envfile"
assert_eq "local: exit 0" "$(cat "$C/rc")" "0"
assert_eq "local: no commands run" "$(cat "$C/log")" ""
assert_eq "local: env file untouched" "$([ -e "$C/envfile" ] && echo exists || echo absent)" "absent"

# 2. Cloud session, nothing configured → provisions CI's DB identity and exports it.
C="$TMP/fresh"; run_hook "$C" CLAUDE_CODE_REMOTE=true CLAUDE_ENV_FILE="$C/envfile"
LOG=$(cat "$C/log"); ENVF=$(cat "$C/envfile" 2>/dev/null)
assert_eq "fresh: exit 0" "$(cat "$C/rc")" "0"
assert_contains "fresh: npm ci (not install)" "$LOG" "npm ci"
assert_absent  "fresh: no npm install" "$LOG" "npm install"
assert_contains "fresh: starts postgres" "$LOG" "service postgresql start"
assert_contains "fresh: creates the CI role" "$LOG" "CREATE ROLE ocrecipes"
assert_contains "fresh: creates the CI database" "$LOG" "createdb -O ocrecipes ocrecipes_test"
assert_contains "fresh: pg_trgm extension" "$LOG" "CREATE EXTENSION IF NOT EXISTS pg_trgm"
assert_contains "fresh: db:push sees CI's DATABASE_URL" "$LOG" "npm run db:push DATABASE_URL=$CI_DB_URL"
assert_contains "fresh: db:push cannot read the session's stdin" "$LOG" "stdin=closed"
assert_contains "fresh: exports DATABASE_URL" "$ENVF" "export DATABASE_URL=$CI_DB_URL"
for v in JWT_SECRET LOG_LEVEL AI_INTEGRATIONS_OPENAI_API_KEY USDA_API_KEY API_NINJAS_KEY RECEIPT_VALIDATION_STUB; do
  assert_contains "fresh: exports $v stub" "$ENVF" "export $v="
done
start_line=$(grep -n 'service postgresql start' "$C/log" | head -1 | cut -d: -f1)
push_line=$(grep -n 'db:push' "$C/log" | head -1 | cut -d: -f1)
if [ -n "$start_line" ] && [ -n "$push_line" ] && [ "$start_line" -lt "$push_line" ]; then
  ok "fresh: postgres starts before db:push"; else bad "fresh: postgres starts before db:push"; fi
assert_eq "fresh: one summary line of output" "$(wc -l < "$C/out" | tr -d ' ')" "1"

# 3. Cloud session with DATABASE_URL set in the environment config → respected, not overwritten.
C="$TMP/preset"; run_hook "$C" CLAUDE_CODE_REMOTE=true CLAUDE_ENV_FILE="$C/envfile" \
  DATABASE_URL=postgresql://me:pw@db.example:5432/mine
LOG=$(cat "$C/log"); ENVF=$(cat "$C/envfile" 2>/dev/null)
assert_eq "preset: exit 0" "$(cat "$C/rc")" "0"
assert_absent "preset: DATABASE_URL not re-exported" "$ENVF" "export DATABASE_URL="
assert_contains "preset: db:push uses the configured URL" "$LOG" "DATABASE_URL=postgresql://me:pw@db.example:5432/mine"

# 4. Re-run (SessionStart also fires on resume/compact) with an unchanged lockfile → no npm ci.
C="$TMP/rerun"; run_hook "$C" CLAUDE_CODE_REMOTE=true CLAUDE_ENV_FILE="$C/envfile"
run_hook "$C" CLAUDE_CODE_REMOTE=true CLAUDE_ENV_FILE="$C/envfile"
assert_absent "rerun: unchanged lockfile skips npm ci" "$(cat "$C/log")" "npm ci"
assert_eq "rerun: env file not duplicated" "$(grep -c '^export DATABASE_URL=' "$C/envfile")" "1"
#    ...and a changed lockfile reinstalls.
echo '{"lockfileVersion":3,"changed":true}' > "$C/proj/package-lock.json"
run_hook "$C" CLAUDE_CODE_REMOTE=true CLAUDE_ENV_FILE="$C/envfile"
assert_contains "rerun: changed lockfile runs npm ci" "$(cat "$C/log")" "npm ci"

# 5. Cloud session without CLAUDE_ENV_FILE → still provisions, exit 0.
C="$TMP/noenvfile"; run_hook "$C" CLAUDE_CODE_REMOTE=true
assert_eq "no env file: exit 0" "$(cat "$C/rc")" "0"
assert_contains "no env file: db:push still gets the URL" "$(cat "$C/log")" "DATABASE_URL=$CI_DB_URL"

# 6. A provisioning step fails (Postgres won't start) → fail open: exit 0, one line naming
#    the log, and no db:push against a database that isn't there.
C="$TMP/broken"; mkdir -p "$C/shims"
printf '#!/usr/bin/env bash\necho "service $*" >> "$SHIM_LOG"\nexit 1\n' > "$C/shims/service"; chmod +x "$C/shims/service"
run_hook "$C" CLAUDE_CODE_REMOTE=true CLAUDE_ENV_FILE="$C/envfile" PATH="$C/shims:$SHIMS:$PATH"
assert_eq "broken: still exit 0 (fail open)" "$(cat "$C/rc")" "0"
assert_contains "broken: says setup failed" "$(cat "$C/out")" "failed"
assert_contains "broken: names the log file" "$(cat "$C/out")" ".log"
assert_absent "broken: no db:push after the failure" "$(cat "$C/log")" "db:push"

[ "$FAIL" -eq 0 ] && echo "PASS: session-start.sh" || { echo "FAILED: session-start.sh"; exit 1; }
