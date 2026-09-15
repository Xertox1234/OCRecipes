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

  # NOT /tmp. The ledger's contents are read back into `additionalContext`, i.e. they
  # become MODEL INPUT, and /tmp is mode 1777 — every process on the box running as this
  # uid can write there. Measured before this changed: a planted directory AND a planted
  # symlink at the old path both delivered attacker-authored text into additionalContext,
  # a frame-shaped `<system-reminder>` block survived verbatim, and with the symlink in
  # place the writers deposited this session's digest INSIDE the attacker's directory —
  # so the exposure ran in both directions. The session id is not a secret that has to be
  # guessed either: /tmp already carries world-readable claude-session-coord-<uuid> and
  # claude-drift-detect-<uuid> entries written at SessionStart, long before the first
  # PreCompact, so an attacker reads the id and pre-plants at leisure.
  #
  # $HOME is the boundary that actually holds — it is not world-writable, so the plant
  # cannot happen in the first place. The reader's symlink/ownership guards are defence in
  # depth on top of this, not a substitute for it.
  #
  # DELIBERATELY NOT ${TMPDIR:-/tmp}. TMPDIR is unset on the ubuntu-latest runner these
  # hook tests run on, so that spelling collapses straight back to world-writable /tmp and
  # the fix silently becomes a no-op in exactly the environment least likely to be noticed.
  # XDG_STATE_HOME is the right variable for state that must survive a reboot but is not
  # config: https://specifications.freedesktop.org/basedir-spec/latest/
  # A RELATIVE XDG_STATE_HOME is IGNORED, which the basedir spec requires ("If an
  # implementation encounters a relative path it MUST be ignored"). Honouring one would
  # make the ledger cwd-relative -- the writers would create it under whatever directory
  # the hook happened to be invoked from, and the reader, invoked from another, would
  # find nothing. That is the same silent-vanish failure the shared-definition rationale
  # at the top of this file exists to remove, arriving by a different route.
  #
  # HOME is read through `${HOME:-}` and refused when empty rather than left to `set -u`:
  # callers run under it, so an unset HOME aborted the function mid-expansion and the
  # error surfaced as ledger-note's "no usable CLAUDE_CODE_SESSION_ID", blaming an input
  # that was fine. A refusal here fails the readers open and gives the writers an
  # accurate message.
  local base="${XDG_STATE_HOME:-}"
  case "$base" in
    /*) ;;
    *) base="${HOME:-}"
       [ -n "$base" ] || return 1
       base="$base/.local/state" ;;
  esac
  printf '%s\n' "${base}/ocrecipes/context-ledger/${sid}"
}

# Is this ledger path one we may read from or write to? Defence in depth behind the $HOME
# root above — that root is what removes the plant; this is what refuses a plant that got
# there some other way (a stale world-writable root from an older build, a shared NFS
# $HOME, CONTEXT_LEDGER_ROOT aimed somewhere loose).
#
# SCOPE, AND IT IS NARROWER THAN THE LINE ABOVE READS. This checks THE PATH IT IS GIVEN,
# never that path's ancestors. Measured: with CONTEXT_LEDGER_ROOT itself a symlink to an
# attacker directory -- equally, a symlink at .../ocrecipes/context-ledger under the
# production root -- the leaf directory and the resume.md inside it are both real and
# both owned by us, every check here returns 0, and a planted resume.md is read into
# additionalContext in full. So "CONTEXT_LEDGER_ROOT aimed somewhere loose" above means a
# loose DIRECTORY, not a symlinked one. Closing the ancestor case needs a component walk,
# which this function deliberately does not do -- do not read it as covered.
#
# Absent is OK: the writers create the directory, and a first run must not be refused.
# Present must be BOTH not-a-symlink AND owned by us. Nothing in this repo ever creates a
# symlink at a ledger position, so one existing there means something else made it.
#
# CALL IT ON THE DIRECTORY BEFORE THE FILE, and the order is not stylistic. When the
# DIRECTORY is the symlink, `-L` on the file inside it is FALSE — the file is a real file
# at the resolved target — so a file-only check passes while the whole directory belongs
# to someone else. `-O` alone is not enough either: an attacker who points the link at any
# file this uid already owns (`~/.ssh/config`, say) passes an ownership test cleanly.
context_ledger_path_ok() {
  local p="${1:-}"
  if [ -z "$p" ]; then return 1; fi
  if [ -L "$p" ]; then return 1; fi
  if [ ! -e "$p" ]; then return 0; fi
  if [ ! -O "$p" ]; then return 1; fi
  return 0
}
