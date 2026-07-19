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

# Match only real `git commit` invocations — in command position (start of command or after a
# shell separator, so compound forms like `git add -A && git commit` are covered), with optional
# env-assignment and `git -c` prefixes. Backslash-escaped quotes are neutralized BEFORE the
# quoted-span strip (a \" would otherwise pair with a later opening quote and delete a real
# `&& git commit` between them — 2026-07-18 audit Phase 6 review), then quoted spans are
# stripped so `echo "x; git commit"` never false-matches (parity with pr-preflight-guard.sh;
# env value class is `*` for the same quote-strip reason).
CMD_BARE=$(printf '%s' "$CMD" | sed "s/\\\\[\"']//g; s/'[^']*'//g; s/\"[^\"]*\"//g")
GIT_COMMIT_RE='(^|[;&|(])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
[[ "$CMD_BARE" =~ $GIT_COMMIT_RE ]] || exit 0

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
