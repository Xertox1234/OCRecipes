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
[ -f "$SCRIPT" ] || exit 0
INPUT=$(cat)
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
