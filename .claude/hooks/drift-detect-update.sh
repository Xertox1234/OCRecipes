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

# Match git ops that may move HEAD (any compound form as well).
# Includes: commit (+ --amend), push, rebase, reset (all forms — bare reset is
# idempotent here: it writes the same SHA already stored), pull, merge, cherry-pick.
HEAD_MOVER_RE='^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|push|rebase|reset|pull|merge|cherry-pick)([[:space:]]|$)'
COMPOUND_MOVER_RE='(&&|\|\||;)[[:space:]]*git[[:space:]]+(commit|push|rebase|reset|pull|merge|cherry-pick)([[:space:]]|$)'

if ! [[ "$CMD" =~ $HEAD_MOVER_RE ]] && ! printf '%s' "$CMD" | grep -qE "$COMPOUND_MOVER_RE"; then
  exit 0
fi

# Ensure we're inside a git repo.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
[ -n "$SESSION" ] || exit 0

CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
[ -n "$CURRENT_SHA" ] || exit 0

printf '%s' "$CURRENT_SHA" > "/tmp/claude-drift-detect-${SESSION}"
exit 0
