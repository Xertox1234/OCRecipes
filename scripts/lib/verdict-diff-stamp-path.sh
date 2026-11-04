#!/usr/bin/env bash
# Single source of truth for the verdict-diff stamp directory (harness diagnosis N7).
#
# Sourced by BOTH the writer (scripts/harness/verdict-diff.sh, which records a completed
# base-vs-head comparison for one commit) and the reader (.claude/hooks/pr-preflight-guard.sh,
# which refuses a PR touching a guard or keyword file until that commit has one).
#
# One file PER COMMIT (<dir>/<full sha>), unlike the preflight stamp's single file: guard PRs run
# in parallel executors, and a single last-writer-wins file would silently drop one of them.
# The directory is keyed to the git COMMON dir, so the main checkout and every linked worktree
# resolve the same place (same scheme as scripts/lib/preflight-stamp-path.sh).
#
# Tests set VERDICT_DIFF_STAMP_DIR to a throwaway directory so they never read a REAL stamp.
#
# Usage:  . scripts/lib/verdict-diff-stamp-path.sh   then   DIR="$(verdict_diff_stamp_dir)"

verdict_diff_stamp_dir() {
  if [ -n "${VERDICT_DIFF_STAMP_DIR:-}" ]; then
    printf '%s\n' "$VERDICT_DIFF_STAMP_DIR"
    return 0
  fi
  local gitdir common key
  gitdir=$(git rev-parse --git-common-dir 2>/dev/null) || gitdir=""
  if [ -n "$gitdir" ]; then
    common=$( cd "$gitdir" 2>/dev/null && pwd -P )
  fi
  if [ -n "${common:-}" ]; then
    key=$(printf '%s' "$common" | shasum 2>/dev/null | cut -c1-12)
  fi
  [ -z "${key:-}" ] && key="global"
  printf '%s\n' "/tmp/ocrecipes-verdict-diff-${key}"
}
