#!/usr/bin/env bash
# .claude/hooks/checkpoint.sh — PreToolUse: checkpoint every dirty worktree BEFORE an Agent
# dispatch or a work-discarding git command (spec 2026-09-27 §4). #956's loss — a reviewer's
# `git checkout --` destroying five uncommitted repairs — is the case this exists for.
#
# Side-effect-only: never prints, never emits a permission decision, always exits 0.
# Waits for scripts/checkpoint.sh up to CHECKPOINT_BUDGET_SECS (default 5), then returns and
# lets the capture finish detached — bash defers a TERM until its foreground `git add`
# returns, so killing it could not bound the wait (plan refinement 1).
# Recovery: bash scripts/checkpoint.sh list; git restore --source=<ref> --worktree -- <path>
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
TOOL=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null) || exit 0
SID=$(jq -r '.session_id // empty' <<<"$INPUT" 2>/dev/null) || exit 0
CWD=$(jq -r '.cwd // empty' <<<"$INPUT" 2>/dev/null) || exit 0
[ -n "$CWD" ] || CWD="$PWD"
case "$SID" in ''|.|..|*[!A-Za-z0-9._-]*) exit 0 ;; esac

case "$TOOL" in
  Agent|Task) TRIGGER=agent ;;
  Bash)
    CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null) || exit 0
    { . "$HERE/lib/cmd-detect.sh"; } >/dev/null 2>&1
    declare -F cmd_git_work_discarder_verb >/dev/null || exit 0
    VERB=$(cmd_git_work_discarder_verb "$CMD") || exit 0
    TRIGGER="git-$VERB" ;;
  *) exit 0 ;;
esac

bash "$ROOT/scripts/checkpoint.sh" capture --session "${SID:0:8}" --trigger "$TRIGGER" --cwd "$CWD" >/dev/null 2>&1 &
CPID=$!
BUDGET="${CHECKPOINT_BUDGET_SECS:-5}"
case "$BUDGET" in ''|*[!0-9]*) BUDGET=5 ;; esac
i=0
while [ "$i" -lt $((BUDGET * 10)) ] && kill -0 "$CPID" 2>/dev/null; do
  sleep 0.1; i=$((i + 1))
done
exit 0
