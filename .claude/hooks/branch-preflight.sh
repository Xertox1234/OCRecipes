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
case "$CMD" in *commit*) : ;; *) exit 0 ;; esac
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
