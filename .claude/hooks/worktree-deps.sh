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

# Enumerate worktrees precisely via git. This handles worktree names that
# contain slashes (which a `.claude/worktrees/*/` glob would miss) and reports
# absolute paths regardless of where this hook is invoked from.
git worktree list --porcelain 2>/dev/null | while read -r key path; do
  [ "$key" = "worktree" ] || continue          # skip HEAD/branch/blank lines
  case "$path" in
    "$MAIN_ROOT"/.claude/worktrees/*) ;;        # a worktree under .claude/worktrees/
    *) continue ;;                              # the main checkout, or elsewhere
  esac
  [ -f "$path/package.json" ] || continue       # not a JS project worktree
  [ -e "$path/node_modules" ] && continue       # real dir or resolvable symlink
  # Absolute target works at any worktree nesting depth. `-fn` replaces a
  # dangling symlink left by an earlier run (e.g. main node_modules was moved).
  ln -sfn "$MAIN_ROOT/node_modules" "$path/node_modules" 2>/dev/null || true
done

exit 0
