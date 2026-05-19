#!/usr/bin/env bash
# PostToolUse(EnterWorktree) + SessionStart hook — give every git worktree under
# .claude/worktrees/ a node_modules so the TypeScript language server can
# resolve dependencies.
#
# `git worktree add` copies tracked files only, so a fresh worktree has no
# node_modules. Without it the worktree's own tsconfig.json — which does
# `"extends": "expo/tsconfig.base.json"` — cannot resolve its base config; the
# whole config silently degrades and the LSP reports phantom "Cannot find
# module" (TS2307) errors for every import in the worktree.
#
# Fix: symlink each worktree's node_modules to the main checkout's. A symlink
# (vs. a per-worktree `npm install`) is instant and shares one install, which
# is correct on a single machine. The hook ignores its stdin so the same
# script works for both trigger events. Idempotent and fail-open.
#
# Tests: .claude/hooks/test-worktree-deps.sh
set -uo pipefail

# Main checkout root. `git rev-parse --git-common-dir` resolves to the MAIN
# repo's .git even when this hook runs from inside a linked worktree.
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
GIT_COMMON=$(cd "$GIT_COMMON" 2>/dev/null && pwd -P) || exit 0
MAIN_ROOT=$(dirname "$GIT_COMMON")

# Nothing to share if the main checkout has no node_modules of its own.
[ -d "$MAIN_ROOT/node_modules" ] || exit 0

WORKTREES_DIR="$MAIN_ROOT/.claude/worktrees"
[ -d "$WORKTREES_DIR" ] || exit 0

for wt in "$WORKTREES_DIR"/*/; do
  [ -d "$wt" ] || continue                   # literal glob when no worktrees exist
  [ -f "${wt}package.json" ] || continue     # not a JS project worktree
  { [ -e "${wt}node_modules" ] || [ -L "${wt}node_modules" ]; } && continue
  # Target is relative: a worktree always sits 3 levels below the repo root.
  ln -s ../../../node_modules "${wt}node_modules" 2>/dev/null || true
done

exit 0
