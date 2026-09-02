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
# Two-stage necessary-substring filter. Stage 1 is the zero-copy glob on raw $CMD.
# Stage 2 runs ONLY on a stage-1 miss, retesting with the characters cmd_words can
# DELETE removed (quotes, backslashes, newlines) — because the cmd_is_* matcher below
# reads `cmd_words`, which deletes quote characters and so sees a verb this filter's
# raw text does not contain: `git com"mit"` holds no literal `commit`, so a
# single-stage filter exited 0 and the matcher was never asked (review, 2026-08-16).
# cmd_words only deletes those characters or inserts the letter `x`, and the needle
# below contains no `x`, so stage 2 is a superset by construction. Four literal
# substitutions, not a bracket class: the class form costs ~1450ms on a 3KB command
# under bash 3.2 versus ~5.5ms for these.
_PRE=0
case "$CMD" in *commit*) _PRE=1 ;; esac
if [ "$_PRE" = 0 ]; then
  _T=${CMD//\'/}; _T=${_T//\"/}; _T=${_T//\\/}; _T=${_T//$'\n'/}; _T=${_T//\$/}
  case "$_T" in *commit*) _PRE=1 ;; esac
fi
[ "$_PRE" = 1 ] || exit 0

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

# WHICH repo did it commit in? `git -C <path> commit` became visible to the matcher above on
# 2026-09-01; before that this hook simply never fired on it. Reporting cwd's staged set for
# a commit made somewhere else would be actively misleading — the whole message is "these
# files are STILL staged", and they would be a different repo's files. `.` for the ordinary
# case; an unresolvable GLOBAL-form redirect (`-C`, `--git-dir`, `--work-tree`) exits
# silently, which is this hook's pre-2026-09-01 behaviour on such a command — the old matcher
# could not see one — and the safe direction for a non-blocking advisory. An inline `GIT_DIR=`
# assignment is NOT in that class: the env absorber has always matched it, so it resolves to
# cwd and nothing about this hook's behaviour there changes.
REPO=$(cmd_git_repo_dir "$CMD" "$_CMD_GIT_VERBS_COMMIT") || exit 0

git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

STAGED=$(git -C "$REPO" diff --cached --name-only 2>/dev/null || true)
HEAD_LINE=$(git -C "$REPO" log --oneline -1 2>/dev/null || echo "(no commits yet)")

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
