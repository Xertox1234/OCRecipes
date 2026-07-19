#!/usr/bin/env bash
# PostToolUse(Bash) — verify a git commit actually landed.
# If staged files remain after a git commit command, the commit was silently
# blocked (by a pre-commit hook deny) or failed. Surface that immediately so
# Claude does not proceed as if the commit succeeded.
# NEVER blocks: always exits 0.
set -uo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Cheap pre-guard: `commit` is a NECESSARY substring of any match (quote-blanking only removes
# characters, never inserts them), so a command lacking it cannot be a git commit — skip the
# scan. Safe because this hook is NON-blocking: a wrongly-skipped command just stays silent.
case "$CMD" in *commit*) : ;; *) exit 0 ;; esac

# Detect `git [-c k=v]* commit` in command position via the shared, quote-AWARE scanner
# (.claude/hooks/lib/cmd-detect.sh) — the single source of the strip + command-position matcher
# across the three PR/commit hooks. Using grep's per-line `^` (via the helper) fixes the
# newline-separated-compound miss of the old `[[ =~ ]]` string-anchored matcher, and the shared
# scan fixes the apostrophe-glue / env-runner misses (2026-07-18 audit /code-review). Lib
# UNSOURCEABLE → exit 0 (silent): the safe direction for a non-blocking advisory hook (matching
# raw would fire false context on quoted mentions).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_git_commit >/dev/null || exit 0
cmd_is_git_commit "$CMD" || exit 0

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

STAGED=$(git diff --cached --name-only 2>/dev/null || true)
HEAD_LINE=$(git log --oneline -1 2>/dev/null || echo "(no commits yet)")

# Clean success (no staged changes remain) is the common case — stay silent to
# avoid a per-commit context message. Only speak on the anomaly worth flagging.
[ -n "$STAGED" ] || exit 0

FILES_LIST=$(printf '%s' "$STAGED" | tr '\n' ' ')
MSG="git commit may have been silently blocked — staged changes still remain after the command: ${FILES_LIST}. Current HEAD: ${HEAD_LINE}. If you used a pathspec commit this is expected; otherwise check pre-commit hook output and re-attempt."

jq -n --arg m "$MSG" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": $m
  }
}'
exit 0
