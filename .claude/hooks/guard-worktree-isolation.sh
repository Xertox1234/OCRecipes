#!/usr/bin/env bash
# PreToolUse hook — block worktree-isolated agents from editing the main checkout.
# When the session cwd is inside .claude/worktrees/agent-*, an Edit/Write/MultiEdit
# whose absolute file_path is under the main repo root but outside that worktree
# is the isolation-leak signature — deny it. Relative paths resolve against the
# (in-worktree) cwd and are always allowed. Fails open on parse failure, matching
# the other hooks in this directory.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -re '.cwd' 2>/dev/null) || exit 0
FILE_PATH=$(printf '%s' "$INPUT" | jq -re '.tool_input.file_path' 2>/dev/null) || exit 0

# Only act when the session is running inside an agent worktree.
case "$CWD" in
  */.claude/worktrees/agent-*) ;;
  *) exit 0 ;;
esac

# Worktree root = cwd truncated at (and including) the agent-<id> path component.
WT_ROOT=$(printf '%s' "$CWD" | sed -E 's#(.*/\.claude/worktrees/agent-[^/]+).*#\1#')
# Main repo root = everything before /.claude/worktrees/.
MAIN_ROOT="${WT_ROOT%/.claude/worktrees/agent-*}"
# An empty MAIN_ROOT would make the deny pattern below collapse to /* and block
# every edit. Unreachable unless the repo lives at filesystem root — fail open.
[ -n "$MAIN_ROOT" ] || exit 0

# Relative file_path resolves against cwd (inside the worktree) — always safe.
case "$FILE_PATH" in
  /*) ;;
  *) exit 0 ;;
esac

# Absolute file_path: classify it.
case "$FILE_PATH" in
  "$WT_ROOT"|"$WT_ROOT"/*) exit 0 ;;   # inside the worktree — allowed
  "$MAIN_ROOT"/*) ;;                   # under main repo, outside worktree — the leak
  *) exit 0 ;;                         # entirely outside the repo (e.g. /tmp) — allowed
esac

REASON=$(printf '%s\n  %s\n%s' \
  "Worktree isolation guard: this session is running inside the agent worktree" \
  "$WT_ROOT" \
  "but the edit targets the absolute path $FILE_PATH under the main checkout. Re-issue the edit with a worktree-rooted path (under the worktree directory above).")

jq -n --arg r "$REASON" \
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
exit 0
