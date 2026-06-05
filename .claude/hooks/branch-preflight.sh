#!/usr/bin/env bash
# PreToolUse(Bash) — block git commit when HEAD is on main/master or detached.
# Commits on main are rejected by branch protection at push time; catching them
# here prevents a confusing local commit that then fails to push.
# Hard-blocks (permissionDecision: deny) — this is never correct in this project.
# Escape: set SKIP_BRANCH_PREFLIGHT=1 in the shell that launched Claude Code.
set -uo pipefail

[ -n "${SKIP_BRANCH_PREFLIGHT:-}" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

GIT_COMMIT_RE='^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
COMPOUND_COMMIT_RE='(&&|\|\||;)[[:space:]]*git[[:space:]]+commit([[:space:]]|$)'

if ! [[ "$CMD" =~ $GIT_COMMIT_RE ]] && ! printf '%s' "$CMD" | grep -qE "$COMPOUND_COMMIT_RE"; then
  exit 0
fi

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

if [ -z "$BRANCH" ]; then
  REASON="HEAD is detached (at ${HEAD_SHA}) — committing here creates an unreachable commit. Create a named branch first: git switch -c <branch-name>"
elif [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  REASON="Refusing to commit on \`${BRANCH}\` — branch protection will reject the push. Switch to a feature branch first: git switch -c <branch-name> (current HEAD: ${HEAD_SHA})"
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
