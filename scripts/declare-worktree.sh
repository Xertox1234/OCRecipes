#!/usr/bin/env bash
# scripts/declare-worktree.sh — manage the session's worktree-contract registry.
#
# Registry: /tmp/claude-worktree-contracts-$CLAUDE_CODE_SESSION_ID/<key>
#   <key>  = first 16 hex chars of shasum(abs worktree path)
#   content = the absolute worktree path (no trailing newline)
#
# While the registry is non-empty, .claude/hooks/guard-worktree-isolation.sh and
# .claude/hooks/git-safety.sh DENY mutating operations outside every registered
# worktree. All subagents share the parent session's CLAUDE_CODE_SESSION_ID
# (verified 2026-07-17), so entries from parallel executors coexist — the registry
# is additive, never a single last-write-wins slot.
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.1.
# Tests: scripts/__tests__/declare-worktree.test.ts
set -euo pipefail

usage() {
  echo "usage: declare-worktree.sh <abs-worktree-path> | --remove <abs-worktree-path> | --clear" >&2
  exit 2
}

SESSION="${CLAUDE_CODE_SESSION_ID:-}"
if [ -z "$SESSION" ]; then
  echo "declare-worktree: CLAUDE_CODE_SESSION_ID is not set — cannot key the registry" >&2
  exit 1
fi
# Charset guard: SESSION keys /tmp paths that reach rm -rf — never allow
# separators or traversal components.
case "$SESSION" in *[!A-Za-z0-9._-]*)
  echo "declare-worktree: CLAUDE_CODE_SESSION_ID contains invalid characters — refusing" >&2
  exit 1 ;;
esac
REG_DIR="/tmp/claude-worktree-contracts-${SESSION}"

key_for() { printf '%s' "$1" | shasum | cut -c1-16; }

case "${1:-}" in
  --clear)
    rm -rf "$REG_DIR"
    echo "cleared worktree-contract registry: $REG_DIR"
    ;;
  --remove)
    P="${2:-}"
    [ -n "$P" ] || usage
    rm -f "$REG_DIR/$(key_for "$P")"
    echo "removed worktree contract: $P"
    ;;
  --*|"")
    usage
    ;;
  *)
    P="$1"
    case "$P" in
      /*) ;;
      *) echo "declare-worktree: path must be absolute: $P" >&2; exit 1 ;;
    esac
    [ -d "$P" ] || { echo "declare-worktree: no such directory: $P" >&2; exit 1; }
    GIT_DIR_P=$(git -C "$P" rev-parse --path-format=absolute --git-dir 2>/dev/null) \
      || { echo "declare-worktree: not inside a git repository: $P" >&2; exit 1; }
    COMMON_P=$(git -C "$P" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
      || { echo "declare-worktree: cannot resolve git common dir: $P" >&2; exit 1; }
    # A linked worktree's git-dir differs from the common dir; the main checkout's
    # doesn't. Registering the main checkout would neuter the guard (it would become
    # an allowed write target) — refuse it.
    if [ "$GIT_DIR_P" = "$COMMON_P" ]; then
      echo "declare-worktree: $P is the main checkout, not a linked worktree — refusing to register it" >&2
      exit 1
    fi
    TOP=$(git -C "$P" rev-parse --show-toplevel)
    if [ "$TOP" != "$P" ]; then
      echo "declare-worktree: $P is not a worktree root (root is $TOP)" >&2
      exit 1
    fi
    mkdir -p "$REG_DIR"
    # /tmp is world-writable: keep the registry private so another local user
    # cannot pre-seed or tamper with contract entries.
    chmod 700 "$REG_DIR"
    printf '%s' "$P" > "$REG_DIR/$(key_for "$P")"
    echo "declared worktree: $P"
    ;;
esac
