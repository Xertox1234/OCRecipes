#!/usr/bin/env bash
# Local pre-push / pre-PR gate. Two modes:
#   scripts/preflight.sh --fast   → fast subset (WIP pushes): tsc + changed-file
#                                   type-aware lint + cheap pattern checks + related tests.
#   scripts/preflight.sh          → full CI parity (PR-branch pushes + before gh pr create);
#                                   writes a HEAD-keyed pass-stamp on success.
# Thin wrapper over the SAME npm scripts CI runs (no drift). Exit non-zero on any failure.
set -uo pipefail

# Pass-stamp path — single source of truth shared with the PR-create guard
# (.claude/hooks/pr-preflight-guard.sh) so the writer and reader never drift.
# shellcheck source=scripts/lib/preflight-stamp-path.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/preflight-stamp-path.sh"
STAMP_FILE="$(preflight_stamp_path)"
MODE="full"
[ "${1:-}" = "--fast" ] && MODE="fast"

# Run one step. Default: buffer output, print a ▶ breadcrumb then a one-line ✔ on success,
# or ✗ + the full captured output on failure. This keeps the happy path quiet — the script's
# output is read into an agent's context on every push. Escapes:
#   PREFLIGHT_DRY_RUN=1 → echo the command, do not execute (self-tests rely on this exact echo).
#   PREFLIGHT_VERBOSE=1 → stream output live, like the pre-2026-07 behavior.
run() {
  if [ -n "${PREFLIGHT_DRY_RUN:-}" ]; then echo "▶ $*"; return 0; fi
  if [ -n "${PREFLIGHT_VERBOSE:-}" ]; then echo "▶ $*"; "$@"; return $?; fi
  printf '▶ %s…\n' "$*"
  local out rc
  out=$("$@" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then
    printf '✔ %s\n' "$*"
  else
    printf '✗ %s\n' "$*"
    printf '%s\n' "$out"
  fi
  return "$rc"
}

if [ "$MODE" = "fast" ]; then
  # Files this branch changed vs main (committed range — push gate semantics).
  # NOTE: no `mapfile` — macOS default bash is 3.2, which lacks it. Use a read loop.
  BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD)
  CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done \
    < <(git diff --name-only --diff-filter=ACMR "$BASE" HEAD -- '*.ts' '*.tsx' 2>/dev/null)

  # Separate probe: hook/husky shell changes. The CHANGED array above only globs *.ts/*.tsx,
  # so an all-.sh push (hooks or husky) would otherwise stamp without ever exercising the
  # changed shell logic. Same BASE..HEAD committed range as CHANGED — push-gate semantics,
  # not the staged/working set. Filter is ACDMRT (includes D and T), not CHANGED's ACMR: this
  # array is only ever used as a boolean gate (never passed to eslint/vitest, which can't take
  # a deleted path), so a hook-file DELETION or TYPECHANGE (e.g. swapped for a symlink) must
  # still trip the gate — each is exactly the kind of shell-logic change run-hook-tests.sh
  # should verify.
  HOOK_CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && HOOK_CHANGED+=("$f"); done \
    < <(git diff --name-only --diff-filter=ACDMRT "$BASE" HEAD -- '.claude/hooks/' '.husky/' 2>/dev/null)

  # Cheap, deterministic, no-DB pattern checks first (fail fast).
  run npm run build:copilot-instructions:check || exit 1

  # Type-aware lint on changed files only (ESLINT_NO_TYPE_AWARE= enables type-aware, matching CI).
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    run env ESLINT_NO_TYPE_AWARE= npx eslint "${CHANGED[@]}" || exit 1
  fi

  # Whole-program type check (cannot be scoped).
  run npm run check:types || exit 1

  # Hook/husky self-tests — the SAME script full-mode preflight and CI call (no drift risk),
  # gated on the probe above so the common TS-only fast path never pays for it. A failure here
  # exits non-zero before the stamp write below, so (unlike the DB-gated related-tests case)
  # no extra tests_skipped-style tracking is needed: there is no "skip for external reason"
  # case for hook tests, only pass or fail.
  if [ "${#HOOK_CHANGED[@]}" -gt 0 ]; then
    run bash scripts/run-hook-tests.sh || exit 1
  fi

  # Tests that import the changed files. A pass-stamp must certify EXECUTED verification,
  # so we track whether the related-tests step actually ran and refuse to stamp if it was
  # skipped for an unreachable DB (else the PR-guard would trust a stamp over zero tests).
  tests_skipped=0
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    if pg_isready -q 2>/dev/null; then
      run npx vitest related --run "${CHANGED[@]}" || exit 1
    else
      echo "⚠ Postgres not reachable — related tests SKIPPED; NOT writing a pass-stamp."
      echo "  (lint + tsc passed; PR creation stays blocked until a run that executes tests — or SKIP_PR_PREFLIGHT=1.)"
      tests_skipped=1
    fi
  fi

  echo "✅ preflight:fast passed"

  # Stamp only when verification was complete: tests ran, or none were needed (no changed TS),
  # AND hook tests ran if hook/husky files changed (or none were needed — the guard above
  # already exits before reaching here on a hook-test failure). A push with neither changed TS
  # nor changed hooks (e.g. all-docs) has nothing left for this gate to verify beyond the two
  # DB-free steps above — it still stamps. That's a conscious choice (nothing to verify →
  # nothing withheld), not an oversight; see .claude/hooks/test-preflight-fast-stamp.sh's
  # "docs-only → stamp" case.
  if [ "$tests_skipped" -eq 0 ]; then
    git rev-parse HEAD > "$STAMP_FILE" 2>/dev/null || true
    echo "✔ pass-stamp written for $(git rev-parse --short HEAD 2>/dev/null)"
  fi
  exit 0
fi

# Full CI parity — mirrors .github/workflows/ci.yml.
run npm run lint || exit 1
run npm run lint:suppress:check || exit 1
run npm run check:types || exit 1
run npm run build:copilot-instructions:check || exit 1
run node scripts/check-accessibility.js || exit 1
run node scripts/check-hardcoded-colors.js || exit 1
run node scripts/check-idor-storage.js || exit 1
run node scripts/check-jsdom-pragma.js || exit 1

# Hook unit tests. The full mechanism — the `.claude/hooks/test-*.sh` glob loop, the inherited
# git-env strip (so a test's `git -C <tmp>` can't be hijacked onto the real repo), per-test
# fail-fast, and the zero-count guard — lives in scripts/run-hook-tests.sh, the SAME script
# CI's "Lint · Types · Patterns" job runs, so the two runners can't drift. Add hooks there.
run bash scripts/run-hook-tests.sh || exit 1

# Tests + coverage need the dev DB. CI runs db:push first; mirror it unless opted out.
# NOTE: db:push mutates the local dev DB schema (stateless Drizzle push — idempotent).
if [ -z "${PREFLIGHT_SKIP_DB_PUSH:-}" ]; then
  # Streamed, NOT via run(): `drizzle-kit push` can prompt on a destructive diff; buffering
  # its output would hide the prompt and hang. Only reached in on-demand full mode.
  echo "▶ npm run db:push (streamed — may prompt on a destructive diff)…"
  npm run db:push || exit 1
fi
run npm run test:coverage:ci || exit 1

# Record a fresh pass for THIS commit so the PR-creation guard (Task 3) can verify it.
git rev-parse HEAD > "$STAMP_FILE" 2>/dev/null || true
echo "✅ preflight passed — stamp written for $(git rev-parse --short HEAD 2>/dev/null)"
exit 0
