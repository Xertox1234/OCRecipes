#!/usr/bin/env bash
# PreToolUse hook — worktree isolation for file-editing tools
# (Edit / Write / MultiEdit / NotebookEdit — see settings.json).
#
# Two modes:
#  1) REGISTRY MODE (primary): when /tmp/claude-worktree-contracts-<session_id>/
#     is non-empty (written by scripts/declare-worktree.sh), every edit must
#     resolve inside ONE of the registered worktrees, or the allowlist
#     (/tmp, /var/folders, ~/.claude) — DENY otherwise. This catches the
#     wrong-checkout incident: writes into the main checkout while a worktree
#     assignment is active. Relative paths resolve against the session cwd.
#     Fail direction: CLOSED (malformed entries / missing fields → deny).
#  2) FALLBACK MODE (no registry): legacy cwd-based escape detection — session
#     cwd inside .claude/worktrees/agent-*, absolute path under the main
#     checkout denied. MAIN_ROOT now derives from `git rev-parse
#     --git-common-dir` (nested-worktree-safe); the old sed math is the last
#     resort for non-repo paths. Fail direction: OPEN (legacy).
#
# Bypass: SKIP_WORKTREE_CONTRACT=1.
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.1.
# Tests: .claude/hooks/test-guard-worktree-isolation.sh
set -uo pipefail

[ -n "${SKIP_WORKTREE_CONTRACT:-}" ] && exit 0

deny() {
  jq -n --arg r "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
  exit 0
}

# Without jq we cannot check an active registry — that must not silently disable
# isolation, so fail closed (hand-built JSON since jq is what's missing).
if ! command -v jq >/dev/null 2>&1; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"guard-worktree-isolation: jq unavailable - failing closed. Bypass: SKIP_WORKTREE_CONTRACT=1."}}'
  exit 0
fi

INPUT=$(cat)
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null || echo "")

REG_DIR=""
[ -n "$SESSION" ] && REG_DIR="/tmp/claude-worktree-contracts-${SESSION}"

if [ -n "$REG_DIR" ] && [ -d "$REG_DIR" ] && [ -n "$(ls -A "$REG_DIR" 2>/dev/null)" ]; then
  # ---------- REGISTRY MODE (fail closed) ----------
  [ -n "$FILE_PATH" ] || deny "guard-worktree-isolation: could not read file_path/notebook_path from hook input while a worktree contract is active — failing closed. Bypass: SKIP_WORKTREE_CONTRACT=1."
  case "$FILE_PATH" in
    /*) RESOLVED="$FILE_PATH" ;;
    *)
      [ -n "$CWD" ] || deny "guard-worktree-isolation: relative path with unknown cwd while a worktree contract is active — failing closed."
      RESOLVED="$CWD/$FILE_PATH"
      ;;
  esac
  # Scratch + harness state stays writable from anywhere.
  case "$RESOLVED" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*|"${HOME:-/nonexistent}"/.claude/*) exit 0 ;;
  esac
  REGISTERED=""
  MATCHED=""
  for entry in "$REG_DIR"/*; do
    WT=$(cat "$entry" 2>/dev/null || echo "")
    case "$WT" in
      /*) ;;
      *) deny "guard-worktree-isolation: malformed registry entry $entry — failing closed. Re-declare with scripts/declare-worktree.sh, or bypass with SKIP_WORKTREE_CONTRACT=1." ;;
    esac
    REGISTERED="${REGISTERED}
  ${WT}"
    case "$RESOLVED" in
      "$WT"|"$WT"/*) MATCHED=1 ;;   # inside a registered worktree — allowed, but keep
                                     # validating every remaining entry (fail-closed
                                     # must not be short-circuited by an early match)
    esac
  done
  [ -n "$MATCHED" ] && exit 0
  deny "Worktree contract violation: this session has active worktree assignment(s):${REGISTERED}
but the edit targets ${RESOLVED} — outside every registered worktree. Re-issue it under the assigned worktree. Escapes: SKIP_WORKTREE_CONTRACT=1 (one command) or scripts/declare-worktree.sh --remove/--clear (assignment ended)."
fi

# ---------- FALLBACK MODE (no registry; fail open — legacy behavior) ----------
[ -n "$CWD" ] || exit 0
[ -n "$FILE_PATH" ] || exit 0

case "$CWD" in
  */.claude/worktrees/agent-*) ;;
  *) exit 0 ;;
esac

# Worktree root = cwd truncated at (and including) the agent-<id> path component.
WT_ROOT=$(printf '%s' "$CWD" | sed -E 's#(.*/\.claude/worktrees/agent-[^/]+).*#\1#')
# Main repo root: ask git (nested-worktree-safe — the common dir always lives in
# the TRUE main checkout); fall back to the sed derivation (single-level only)
# when git can't answer, e.g. for the fake paths in unit tests.
MAIN_ROOT=""
COMMON=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
[ -n "$COMMON" ] && MAIN_ROOT=$(dirname "$COMMON")
[ -n "$MAIN_ROOT" ] || MAIN_ROOT="${WT_ROOT%/.claude/worktrees/agent-*}"
[ -n "$MAIN_ROOT" ] || exit 0

# Relative file_path resolves against cwd (inside the worktree) — always safe.
case "$FILE_PATH" in
  /*) ;;
  *) exit 0 ;;
esac

case "$FILE_PATH" in
  "$WT_ROOT"|"$WT_ROOT"/*) exit 0 ;;   # inside the worktree — allowed
  "$MAIN_ROOT"/*) ;;                   # under main repo, outside worktree — the leak
  *) exit 0 ;;                         # entirely outside the repo — allowed
esac

deny "Worktree isolation guard: this session is running inside the agent worktree
  $WT_ROOT
but the edit targets the absolute path $FILE_PATH under the main checkout. Re-issue the edit with a worktree-rooted path (under the worktree directory above)."
