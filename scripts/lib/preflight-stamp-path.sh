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
# Sessions in the SAME repo used to overwrite each other's stamp (last writer wins); the
# per-commit stamps below (preflight_stamp_write / preflight_stamp_has) end that.
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

# Per-commit stamps: one empty file per passed commit in "<stamp path>.d/<sha>". The single
# slot above is shared by every worktree and session of the repo, so a parallel push on another
# branch overwrote it — all 6 stale-stamp PR denials in 10-30..11-01 found another branch's sha
# there (harness item 8). The slot is still written (it names the newest pass for deny messages)
# and still read (a stamp from before this change, or from a tree on an older helper, counts).
# Only a 40-hex sha is accepted as a name: the directory lives in /tmp.
preflight_stamp_write() { # $1 = full sha of a commit that just passed
  local f
  case "${1:-}" in "" | *[!0-9a-f]*) return 1 ;; esac
  [ "${#1}" -eq 40 ] || return 1
  f="$(preflight_stamp_path)"
  mkdir -p "$f.d" 2>/dev/null && : > "$f.d/$1" 2>/dev/null
  printf '%s\n' "$1" > "$f" 2>/dev/null
}

preflight_stamp_has() { # $1 = full sha → exit 0 when that commit passed
  local f
  case "${1:-}" in "" | *[!0-9a-f]*) return 1 ;; esac
  [ "${#1}" -eq 40 ] || return 1
  f="$(preflight_stamp_path)"
  [ -f "$f.d/$1" ] && return 0
  [ "$(cat "$f" 2>/dev/null)" = "$1" ]
}
