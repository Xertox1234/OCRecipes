#!/usr/bin/env bash
# PostToolUse(Bash) advisory — nudge toward the LSP for symbol searches.
# NEVER blocks: always exits 0. Throttled once-per-session-per-pattern.
set -uo pipefail

[ "${LSP_NUDGE_OFF:-0}" = "1" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
SESSION=$(printf '%s' "$INPUT" | jq -re '.session_id' 2>/dev/null || echo nosess)

# Must invoke grep or rg.
printf '%s' "$CMD" | grep -Eq '(^|[|&; ])(grep|rg)([[:space:]]|$)' || exit 0
# Skip fixed-string/text intent and infra contexts.
printf '%s' "$CMD" | grep -Eq -- '(-F|--fixed-strings)' && exit 0
printf '%s' "$CMD" | grep -Eq 'ci:failed-logs|npm run |node_modules|[[:space:]]gh[[:space:]]' && exit 0

# Extract a quoted single-token pattern after grep/rg.
PATTERN=$(printf '%s' "$CMD" \
  | grep -Eo "(grep|rg)[^|]*" \
  | grep -Eo "([\"'])[A-Za-z_][A-Za-z0-9_]{2,}\1" \
  | head -n1 | tr -d "\"'")
[ -n "$PATTERN" ] || exit 0
# Pattern must contain no regex metacharacters.
printf '%s' "$PATTERN" | grep -Eq '[][().*+?^$\\|{}]' && exit 0
# Must look like a code identifier (camelCase / PascalCase / snake_case).
printf '%s' "$PATTERN" | grep -Eq '([a-z][A-Z]|_|^[A-Z][a-z])' || exit 0
# Must target TypeScript or be repo-wide (-r / no path).
printf '%s' "$CMD" | grep -Eq '\.tsx?|include=[^ ]*ts|-g [^ ]*ts|(^|[[:space:]])-r([[:space:]]|$)|-rn?' || exit 0

# Throttle: once per session per pattern.
STATE="/tmp/ocrecipes-lsp-nudge-${SESSION}"
touch "$STATE"
grep -qxF "$PATTERN" "$STATE" 2>/dev/null && exit 0
printf '%s\n' "$PATTERN" >> "$STATE"

jq -n --arg p "$PATTERN" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": ("Looks like a symbol search for `" + $p + "`. For accurate, alias-aware results prefer the LSP tool (findReferences / workspaceSymbol) over grep — see docs/rules/lsp.md.")
  }
}'
exit 0
