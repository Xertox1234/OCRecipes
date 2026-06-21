#!/usr/bin/env bash
# Local pre-push / pre-PR gate. Two modes:
#   scripts/preflight.sh --fast   → fast subset (WIP pushes): tsc + changed-file
#                                   type-aware lint + cheap pattern checks + related tests.
#   scripts/preflight.sh          → full CI parity (PR-branch pushes + before gh pr create);
#                                   writes a HEAD-keyed pass-stamp on success.
# Thin wrapper over the SAME npm scripts CI runs (no drift). Exit non-zero on any failure.
set -uo pipefail

STAMP_FILE="/tmp/ocrecipes-preflight-pass"
MODE="full"
[ "${1:-}" = "--fast" ] && MODE="fast"
[ "${1:-}" = "--staged" ] && MODE="staged"

# PREFLIGHT_DRY_RUN=1 → echo the command but do not execute (used by the gate's tests).
run() { echo "▶ $*"; [ -n "${PREFLIGHT_DRY_RUN:-}" ] && return 0; "$@"; }

if [ "$MODE" = "fast" ]; then
  # Files this branch changed vs main (committed range — push gate semantics).
  # NOTE: no `mapfile` — macOS default bash is 3.2, which lacks it. Use a read loop.
  BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD)
  CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done \
    < <(git diff --name-only --diff-filter=ACMR "$BASE" HEAD -- '*.ts' '*.tsx' 2>/dev/null)

  # Cheap, deterministic, no-DB pattern checks first (fail fast).
  run npm run build:copilot-instructions:check || exit 1
  run npm run lsp:check-agent-block || exit 1

  # Type-aware lint on changed files only (ESLINT_NO_TYPE_AWARE= enables type-aware, matching CI).
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    run env ESLINT_NO_TYPE_AWARE= npx eslint "${CHANGED[@]}" || exit 1
  fi

  # Whole-program type check (cannot be scoped).
  run npm run check:types || exit 1

  # Tests that import the changed files. Degrade to a warning if Postgres is unreachable.
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    if pg_isready -q 2>/dev/null; then
      run npx vitest related --run "${CHANGED[@]}" || exit 1
    else
      echo "⚠ Postgres not reachable — skipping related tests (they'll run in CI / full preflight)."
    fi
  fi

  echo "✅ preflight:fast passed"
  exit 0
fi

if [ "$MODE" = "staged" ]; then
  # Files staged for THIS commit (what is about to be committed).
  CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done \
    < <(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' 2>/dev/null)

  # Separate probe: anything staged that can affect types — .ts/.tsx plus .json
  # (resolveJsonModule) and tsconfig* (path/config changes a .ts-only filter misses).
  TS_AFFECTING=$(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.json' 'tsconfig*' 2>/dev/null)

  # Type-aware lint on staged TS files only (ESLINT_NO_TYPE_AWARE= enables type-aware).
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    run env ESLINT_NO_TYPE_AWARE= npx eslint "${CHANGED[@]}" || exit 1
  fi

  # Incremental whole-program type check when any type-affecting file is staged.
  if [ -n "$TS_AFFECTING" ]; then
    run npm run check:types:incremental || exit 1
  fi

  # Unit tests reachable from the staged files. Integration tests (server/storage/__tests__)
  # are excluded — they need the dev DB, which may be stale right after a schema edit.
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    run npx vitest related --run "${CHANGED[@]}" --exclude 'server/storage/__tests__/**' || exit 1
  fi

  echo "✅ preflight:staged passed"
  exit 0
fi

# Full CI parity — mirrors .github/workflows/ci.yml.
run npm run lint || exit 1
run npm run lint:suppress:check || exit 1
run npm run check:types || exit 1
run npm run build:copilot-instructions:check || exit 1
run npm run lsp:check-agent-block || exit 1
run node scripts/check-accessibility.js || exit 1
run node scripts/check-hardcoded-colors.js || exit 1
run node scripts/check-idor-storage.js || exit 1
run node scripts/check-jsdom-pragma.js || exit 1

# Hook unit tests. CI's "Lint · Types · Patterns" job runs the `.claude/hooks/test-*.sh`
# suite; mirror it so a broken hook test is caught locally, not only in CI (a failing hook
# test is a "PR run failed" category the gate would otherwise miss). Loop over every test
# present so newly-added hook tests are picked up automatically (no drift).
for t in .claude/hooks/test-*.sh; do
  [ -f "$t" ] || continue
  run bash "$t" || exit 1
done

# Tests + coverage need the dev DB. CI runs db:push first; mirror it unless opted out.
# NOTE: db:push mutates the local dev DB schema (stateless Drizzle push — idempotent).
if [ -z "${PREFLIGHT_SKIP_DB_PUSH:-}" ]; then
  run npm run db:push || exit 1
fi
run npm run test:coverage:ci || exit 1

# Record a fresh pass for THIS commit so the PR-creation guard (Task 3) can verify it.
git rev-parse HEAD > "$STAMP_FILE" 2>/dev/null || true
echo "✅ preflight passed — stamp written for $(git rev-parse --short HEAD 2>/dev/null)"
exit 0
