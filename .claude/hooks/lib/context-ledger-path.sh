#!/usr/bin/env bash
# Single source of truth for the context-ledger DIRECTORY.
#
# Sourced by BOTH the writer (.claude/hooks/precompact-ledger.sh) and the reader
# (.claude/hooks/session-resume-ledger.sh). One definition means the two cannot drift;
# if they ever did, the reader looks for a path the writer never wrote and the digest
# silently vanishes — the failure mode is invisible, which is why this is shared.
#
# Keyed by SESSION ID, never by repo or cwd. Session id is the only identifier verified
# stable across BOTH boundaries that matter: compaction (the session continues in the same
# .jsonl) and worktree entry (the id survives while the project directory moves).
# Repo-keying would collide — linked worktrees share --git-common-dir.
#
# Tests set CONTEXT_LEDGER_ROOT to a throwaway path so they never touch real state.

context_ledger_dir() {
  local sid="${1:-}"

  # Reject empty, dot-paths, and anything outside [A-Za-z0-9._-].
  # `.` and `..` are listed EXPLICITLY: they contain only characters the class allows,
  # so the character test alone lets them through, and with CONTEXT_LEDGER_ROOT set
  # "$ROOT/.." escapes the test root.
  case "$sid" in
    ''|.|..|*[!A-Za-z0-9._-]*) return 1 ;;
  esac

  if [ -n "${CONTEXT_LEDGER_ROOT:-}" ]; then
    printf '%s\n' "${CONTEXT_LEDGER_ROOT}/${sid}"
    return 0
  fi

  printf '%s\n' "/tmp/ocrecipes-context-ledger-${sid}"
}
