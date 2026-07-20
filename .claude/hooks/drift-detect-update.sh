#!/usr/bin/env bash
# PostToolUse(Bash) — record HEAD after any Claude-initiated HEAD-moving git op.
#
# Companion to drift-detect.sh (PreToolUse). After Claude runs a git op that moves HEAD
# (commit, push, amend, rebase, reset, pull, merge, cherry-pick), record the current HEAD
# SHA so the next PreToolUse drift-detect check knows Claude is the one who moved it.
#
# Read-only git ops (status, log, diff, show, fetch without merge) must NOT update the
# baseline — otherwise an external drift that occurs between a `git log` and a commit
# would be absorbed and silently missed.
#
# Design principles:
#   - NEVER blocks: always exits 0.
#   - Keyed by session_id from the hook JSON (symmetric with drift-detect.sh).
#   - Fails open on any parse / git error.
#
# Tests: .claude/hooks/test-drift-detect.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Match git ops that may move HEAD via the shared quote-AWARE matcher (lib/cmd-detect.sh):
# commit (+ --amend), push, rebase, reset (bare reset is idempotent here — re-writes the same
# SHA), pull, merge, cherry-pick. A quoted mention of one of these verbs must NOT stamp the
# baseline (that would silently absorb a real drift). Cheap superset first. This hook WRITES the
# baseline, so on an unsourceable lib fail SILENT (skip the stamp): a stale baseline only causes
# a false drift warning next time, whereas a wrongful write absorbs a real drift.
case "$CMD" in *git*) : ;; *) exit 0 ;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_git_head_mover >/dev/null || exit 0
cmd_is_git_head_mover "$CMD" || exit 0

# Ensure we're inside a git repo.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
[ -n "$SESSION" ] || exit 0

CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
[ -n "$CURRENT_SHA" ] || exit 0

printf '%s' "$CURRENT_SHA" > "/tmp/claude-drift-detect-${SESSION}"
exit 0
