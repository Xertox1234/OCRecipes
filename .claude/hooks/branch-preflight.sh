#!/usr/bin/env bash
# PreToolUse(Bash) — block git commit only when HEAD is detached.
# A detached-HEAD commit is unreachable (silent data loss), so we hard-block it.
# Committing on main/master locally is not blocked HERE, but pushing main is
# rejected by GitHub branch protection (enforce_admins: true, 8 required checks —
# verified live 2026-07-16). All work reaches main via PR.
# Escape: set SKIP_BRANCH_PREFLIGHT=1 in the shell that launched Claude Code.
set -uo pipefail

[ -n "${SKIP_BRANCH_PREFLIGHT:-}" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Only proceed for an actual `git commit`. Cheap necessary-condition superset first, then the
# shared quote-AWARE matcher (lib/cmd-detect.sh) so a quoted mention — `-m "…; git commit …"` —
# never false-DENYs a legitimate command.
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
  _T=${CMD//\'/}; _T=${_T//\"/}; _T=${_T//\\/}; _T=${_T//$'\n'/}
  case "$_T" in *commit*) _PRE=1 ;; esac
fi
[ "$_PRE" = 1 ] || exit 0
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if . "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_git_commit >/dev/null; then
  cmd_is_git_commit "$CMD" || exit 0
else
  # Lib unsourceable → this is a BLOCKING gate, so fail CLOSED: keep the raw (quote-unaware)
  # match so a real detached-HEAD commit is still caught. Behaviour is then identical to the
  # pre-port hook; a quoted mention may false-DENY, the accepted cost of never fail-OPENing.
  GIT_COMMIT_RE='^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
  COMPOUND_COMMIT_RE='(&&|\|\||;)[[:space:]]*git[[:space:]]+commit([[:space:]]|$)'
  if ! [[ "$CMD" =~ $GIT_COMMIT_RE ]] && ! printf '%s' "$CMD" | grep -qE "$COMPOUND_COMMIT_RE"; then
    exit 0
  fi
fi

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

if [ -z "$BRANCH" ]; then
  REASON="HEAD is detached (at ${HEAD_SHA}) — committing here creates an unreachable commit. Create a named branch first: git switch -c <branch-name>"
else
  exit 0
fi

jq -n --arg r "$REASON" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": $r
  }
}'
exit 0
