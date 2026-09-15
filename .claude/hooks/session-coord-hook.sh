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
  # `.`/`..` listed explicitly, matching context_ledger_dir()'s same guard: both contain
  # only characters the character class already allows, so the class alone lets them
  # through.
  case "$SESSION_ID" in ''|.|..|*[!A-Za-z0-9._-]*) SESSION_ID="" ;; esac
  [ -n "$SESSION_ID" ] && rm -rf "/tmp/claude-worktree-contracts-${SESSION_ID}"
  # Context ledger (docs/superpowers/specs/2026-09-12-context-ledger-design.md §4.4).
  # Same guarded SESSION_ID, same SessionEnd wiring — a second cleanup hook would be a
  # second thing to forget.
  #
  # Ask lib/context-ledger-path.sh for the directory rather than rebuilding the formula
  # here. That header declares itself the single source of truth for this path, and the
  # inline copy this replaced was already drifting from it in two ways:
  #   1. It never honoured CONTEXT_LEDGER_ROOT, so with that variable set the WRITERS
  #      (precompact-ledger.sh, ledger-note.sh) put the ledger under $ROOT/<sid> while
  #      this line deleted /tmp/ocrecipes-context-ledger-<sid> — SessionEnd silently
  #      cleaned nothing and the ledger persisted. That divergence is also why
  #      test-context-ledger.sh's Task 5 had to abandon the hermetic root every other
  #      case in that file uses and drive the real /tmp path instead.
  #   2. The charset guard above admits `.` and `..`, which context_ledger_dir() rejects
  #      EXPLICITLY (they contain only characters the class already allows). Harmless at
  #      this line as it stood — the sid was a hyphen-glued filename SUFFIX on a fixed
  #      prefix, so `..` named a literal entry and could not escape — but the helper's
  #      CONTEXT_LEDGER_ROOT branch makes the sid a real path SEGMENT, where `$ROOT/..`
  #      resolves to ROOT's parent. Routing through the helper means this consumer
  #      inherits that rejection instead of re-deriving a weaker one.
  # The charset guard stays: the worktree-contracts path above is a different family
  # (scripts/declare-worktree.sh builds it the same suffix way) and still needs it.
  if [ -n "$SESSION_ID" ] && [ -r "$ROOT/.claude/hooks/lib/context-ledger-path.sh" ]; then
    # shellcheck source=lib/context-ledger-path.sh
    . "$ROOT/.claude/hooks/lib/context-ledger-path.sh"
    if declare -F context_ledger_dir >/dev/null; then
      LEDGER_DIR=$(context_ledger_dir "$SESSION_ID") && [ -n "$LEDGER_DIR" ] \
        && rm -rf "$LEDGER_DIR"
    fi
  fi
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
