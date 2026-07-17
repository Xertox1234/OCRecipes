#!/usr/bin/env bash
# .claude/hooks/session-coord-hook.sh — thin dispatch shim between Claude Code hook
# events and scripts/pg-lab/session-coord.sh (spec §5.3).
#
# Write-path subcommands (register/record/deregister) are BACKGROUNDED with stdout and
# stderr discarded: the hook returns immediately and a coordination failure can never
# slow or break the hot path. `consult` (PreToolUse, wired in PR 2) is the one
# synchronous subcommand — its stdout IS the hook's additionalContext output.
set -uo pipefail
SUB="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/pg-lab/session-coord.sh"
INPUT=$(cat)
# SessionEnd: remove the session's worktree-contract registry (guardrails spec §3.1)
# BEFORE the pg-lab existence gate — cleanup must not depend on pg-lab being present.
if [ "$SUB" = "deregister" ] && command -v jq >/dev/null 2>&1; then
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
  # Charset guard: this value reaches rm -rf — never allow separators/traversal.
  case "$SESSION_ID" in ''|*[!A-Za-z0-9._-]*) SESSION_ID="" ;; esac
  [ -n "$SESSION_ID" ] && rm -rf "/tmp/claude-worktree-contracts-${SESSION_ID}"
fi
[ -f "$SCRIPT" ] || exit 0
case "$SUB" in
  consult)
    printf '%s' "$INPUT" | bash "$SCRIPT" consult --stdin-json
    ;;
  register|record|deregister)
    # --stdin-json is only meaningful to register's CLI/hook-mode branch; record and
    # deregister always read stdin unconditionally and ignore the flag entirely.
    printf '%s' "$INPUT" | bash "$SCRIPT" "$SUB" --stdin-json >/dev/null 2>&1 &
    ;;
esac
exit 0
