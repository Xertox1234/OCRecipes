#!/usr/bin/env bash
# PostToolUse(EnterWorktree) + SessionStart hook — give every git worktree under
# the two harness-managed roots, .claude/worktrees/ (Agent isolation, e.g. /todo
# executors) and .worktrees/ (the /audit skill), the gitignored, local-only files
# it needs but that `git worktree add` does not copy:
#   - node_modules — so the TypeScript language server can resolve dependencies.
#   - docs/LEARNINGS.md — gitignored local learnings file the todo-executor
#     research step greps.
#
# Scope is deliberately these two roots, not every linked worktree: a user's own
# ad hoc `git worktree add` (elsewhere) may want a clean install, not a shared
# symlink. Ad hoc worktrees are covered separately by .husky/post-checkout for
# .env* and docs/LEARNINGS.md (that hook has no path predicate).
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

# Nothing to share if the main checkout has none of the linkable sources.
[ -d "$MAIN_ROOT/node_modules" ] || [ -f "$MAIN_ROOT/docs/LEARNINGS.md" ] || exit 0

# Enumerate worktrees precisely via git. This handles worktree names that
# contain slashes (which a `.claude/worktrees/*/` glob would miss) and reports
# absolute paths regardless of where this hook is invoked from.
git worktree list --porcelain 2>/dev/null | while read -r key path; do
  [ "$key" = "worktree" ] || continue          # skip HEAD/branch/blank lines
  case "$path" in
    "$MAIN_ROOT"/.claude/worktrees/*|"$MAIN_ROOT"/.worktrees/*) ;;  # harness-managed roots
    *) continue ;;                              # the main checkout, or elsewhere
  esac
  [ -f "$path/package.json" ] || continue       # not a JS project worktree

  # Absolute targets work at any worktree nesting depth. `-fn` replaces a
  # dangling symlink left by an earlier run (e.g. the main source was moved).
  # Each link is independent and guarded: create only when the main checkout
  # has the source and the worktree lacks a resolvable copy.
  if [ -d "$MAIN_ROOT/node_modules" ] && [ ! -e "$path/node_modules" ]; then
    ln -sfn "$MAIN_ROOT/node_modules" "$path/node_modules" 2>/dev/null || true
  fi
  if [ -f "$MAIN_ROOT/docs/LEARNINGS.md" ] && [ ! -e "$path/docs/LEARNINGS.md" ]; then
    mkdir -p "$path/docs" 2>/dev/null || true
    ln -sfn "$MAIN_ROOT/docs/LEARNINGS.md" "$path/docs/LEARNINGS.md" 2>/dev/null || true
  fi
done

exit 0
