#!/usr/bin/env bash
# Single source for the hook self-test suite. Called by BOTH scripts/preflight.sh (full mode)
# and .github/workflows/ci.yml ("Lint · Types · Patterns" → "Hook self-tests") so the two
# runners can never drift on membership or mechanism. Add or rename hooks here, not in either
# caller.
#
# Owns the full mechanism:
#   - the `.claude/hooks/test-*.sh` glob loop, so newly-added hook tests run automatically;
#   - the five-variable `env -u` git-env strip, so a test's `git -C <tmp>` can't be hijacked
#     onto the real repo by an inherited absolute GIT_DIR (VS Code terminal / worktree) — see
#     docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md;
#   - per-test fail-fast (`|| exit 1`, load-bearing — this runs under preflight's no-`-e` shell);
#   - a `▶ <test>` marker per test for step-log readability;
#   - a zero-count fail-closed guard, so an unmatched glob fails RED instead of passing green —
#     see docs/solutions/logic-errors/empty-probe-output-needs-exit-code-check-2026-07-02.md.
#
# Caller-agnostic: no dependence on preflight's run() helper. Plain `set -uo pipefail` +
# explicit `exit 1` so it behaves identically under preflight (no -e) and GitHub's
# `bash -eo pipefail`. `ran=$((ran+1))` — NOT `((ran++))`, which returns non-zero at 0 and
# would kill the step under -e.
set -uo pipefail

ran=0
for t in .claude/hooks/test-*.sh; do
  [ -f "$t" ] || continue
  echo "▶ $t"
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_COMMON_DIR bash "$t" || exit 1
  ran=$((ran+1))
done

if [ "$ran" -eq 0 ]; then
  echo "::error::.claude/hooks/test-*.sh matched no files — hook self-test suite did not run"
  exit 1
fi

echo "✓ $ran hook self-tests passed"
