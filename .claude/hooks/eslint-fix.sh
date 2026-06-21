#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit) — auto-fix lint on the changed file, and
# surface any remaining (unfixable) problems as additionalContext so they become
# actionable feedback now instead of silently waiting for the pre-push/CI gate.
#
# Type-aware rules are intentionally skipped here for speed (ESLINT_NO_TYPE_AWARE=1);
# pre-commit lint-staged + CI cover that rule class.
#
# NEVER blocks: always exits 0. Stays silent on a clean fix (the common case) and
# only speaks when eslint --fix leaves problems it could not repair.
#
# Tests: .claude/hooks/test-eslint-fix.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -n "$FILE" ] || exit 0

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.cjs|*.mjs) ;;
  *) exit 0 ;;
esac

OUTPUT=$(ESLINT_NO_TYPE_AWARE=1 npx eslint --no-warn-ignored --fix "$FILE" 2>&1)
STATUS=$?

# Clean: every problem was auto-fixed or there were none → stay silent.
[ "$STATUS" -eq 0 ] && exit 0

# Problems remain (or eslint errored). Surface a trimmed report.
TRIMMED=$(printf '%s' "$OUTPUT" | head -n 40)
MSG="eslint --fix ran on ${FILE} but left problems it could not auto-fix (exit ${STATUS}). Resolve these now rather than waiting for the pre-push/CI gate:
${TRIMMED}"

jq -n --arg m "$MSG" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": $m
  }
}'
exit 0
