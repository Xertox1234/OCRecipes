#!/usr/bin/env bash
# Single source of truth for the preflight PR-gate pass-stamp path.
#
# Sourced by BOTH the writer (scripts/preflight.sh, which records a pass for the
# current HEAD) and the reader (.claude/hooks/pr-preflight-guard.sh, which blocks
# PR creation until that pass exists). Defining the path in ONE place guarantees the
# two never drift — and any future drift fails toward DENY (PR blocked, bypassable
# with SKIP_PR_PREFLIGHT), never toward accepting a stale stamp.
#
# The path is keyed to the repository's git COMMON dir — the directory shared by the
# main checkout and every linked worktree — so:
#   - it is cwd-invariant: writer and reader resolve the SAME file no matter which
#     worktree or subdir each runs from (the /todo MCP-create flow, where the hook
#     may fire from a different cwd than the preflight run, relies on this);
#   - different repositories get different stamps (no cross-repo clobber);
#   - the old global /tmp path — which let one repo's hook self-test wipe another
#     session's freshly-earned stamp — is gone.
# Residual (accepted, self-healing): two concurrent FULL preflights in the SAME repo
# still last-writer-wins on the stamp; just re-run preflight. See the todo for context.
#
# Tests set PREFLIGHT_STAMP_FILE to a throwaway path so they never read or delete a
# REAL stamp.
#
# Usage:  . scripts/lib/preflight-stamp-path.sh   then   STAMP_FILE="$(preflight_stamp_path)"

preflight_stamp_path() {
  # Explicit override (tests) wins — short-circuits before any git call.
  if [ -n "${PREFLIGHT_STAMP_FILE:-}" ]; then
    printf '%s\n' "$PREFLIGHT_STAMP_FILE"
    return 0
  fi

  local gitdir common key
  gitdir=$(git rev-parse --git-common-dir 2>/dev/null) || gitdir=""
  if [ -n "$gitdir" ]; then
    # Canonicalize (resolves the relative ".git" and any symlinks) so the key is
    # identical from the main checkout and from every worktree of this repo.
    common=$( cd "$gitdir" 2>/dev/null && pwd -P )
  fi
  if [ -n "${common:-}" ]; then
    key=$(printf '%s' "$common" | shasum 2>/dev/null | cut -c1-12)
  fi
  # Deterministic fallback when git/shasum are unavailable: writer and reader still
  # agree (same code path), so the gate keeps working; only per-repo isolation is lost.
  [ -z "${key:-}" ] && key="global"

  printf '%s\n' "/tmp/ocrecipes-preflight-pass-${key}"
}
