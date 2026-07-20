#!/usr/bin/env bash
# PreToolUse(Bash) — auto-heal an externally-flipped core.bare before any git command.
#
# An external actor (the VS Code Git extension on restart, or hand-removing a harness
# isolation:worktree) can flip the SHARED .git/config core.bare to true. Once true, every
# work-tree git op in this checkout fails with "this operation must be run in a work tree"
# (git status / commit / rebase), and worktrees sharing the common .git/config all break at
# once. `git config` itself works regardless of core.bare, so this hook resets it before the
# user's git command runs — the only layer that can: a husky hook would arrive after git has
# already refused. (todos P2 git-churn.)
#
# Design: WARN (never block) and only when it actually corrected something — silent otherwise.
# Fails open on any parse/git error. Fires before any `git` command.
# Tests: .claude/hooks/test-core-bare-guard.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Only act when the command actually invokes git, via the shared quote-AWARE matcher
# (lib/cmd-detect.sh) — a quoted mention like `echo "…; git …"` must not trigger the heal.
# Cheap necessary-condition superset first. Advisory hook → fail SILENT if the lib is
# unsourceable: a skipped heal is not silent breakage (git's own "must be run in a work tree"
# error is the loud backstop), whereas matching the raw command would re-open the false match.
case "$CMD" in *git*) : ;; *) exit 0 ;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_git >/dev/null || exit 0
cmd_is_git "$CMD" || exit 0

# Must be inside a git repo (config read works even when core.bare is wrongly true).
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

[ "$(git config --bool core.bare 2>/dev/null)" = "true" ] || exit 0

# Claude always operates in a working checkout (or a worktree), never a legitimately-bare
# repo, so core.bare=true here is always the external-flip bug. Reset it. (Detecting a work
# tree to "be safe" is itself unreliable while core.bare is wrongly true, so we don't.)
git config core.bare false 2>/dev/null || exit 0

MSG="Auto-corrected core.bare=true → false in this checkout's .git/config before your git command. An external actor (VS Code's Git extension on restart, or a removed harness worktree) flipped it; left true it breaks git status/commit/rebase across every worktree sharing this .git/config. See todos/P2 git-churn."
jq -n --arg m "$MSG" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": $m
  }
}'
exit 0
