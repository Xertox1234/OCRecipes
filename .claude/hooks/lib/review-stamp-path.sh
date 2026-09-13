#!/usr/bin/env bash
# Single source of truth for the review-stamp DIRECTORY.
#
# Sourced by BOTH the writer (.claude/hooks/review-stamp-writer.sh) and the reader
# (.claude/hooks/merge-review-guard.sh). One definition means the two cannot drift; if
# they ever did, the reader looks for a path the writer never wrote — which denies the
# merge. That is the fail-closed direction: confusing, never dangerous.
#
# Keyed by repo AND reviewed head SHA:
#   <repokey>  isolates repositories (mirrors scripts/lib/preflight-stamp-path.sh, and
#              stops one repo's hook self-test wiping another's stamps)
#   <head_sha> is LOAD-BEARING, not cosmetic. Linked worktrees share --git-common-dir,
#              so a /todo executor's reviewers resolve the SAME repokey as an interactive
#              session. Only this segment keeps up-to-4 concurrent executors from
#              clobbering each other's stamps.
#
# One FILE PER REVIEWER lives inside the directory, so parallel roster dispatch
# (docs/AI_WORKFLOW.md:21 sends code-reviewer + 1-2 domain reviewers at once) never needs
# a read-modify-write and therefore cannot race.
#
# Tests set REVIEW_STAMP_ROOT to a throwaway path so they never touch a real stamp.

review_stamp_dir() {
  local sha="${1:?usage: review_stamp_dir <head-sha>}"

  if [ -n "${REVIEW_STAMP_ROOT:-}" ]; then
    printf '%s\n' "${REVIEW_STAMP_ROOT}/${sha}"
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
  # Deterministic fallback when git/shasum are unavailable: writer and reader still agree
  # (same code path); only per-repo isolation is lost.
  [ -z "${key:-}" ] && key="global"

  printf '%s\n' "/tmp/ocrecipes-review-stamps-${key}/${sha}"
}
