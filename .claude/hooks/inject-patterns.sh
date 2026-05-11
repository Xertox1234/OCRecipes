#!/usr/bin/env bash
# PreToolUse hook — inject relevant patterns, rules, and learnings before Edit/Write
# Reads tool event JSON from stdin; outputs additionalContext JSON or exits 0 silently.
set -uo pipefail

INPUT=$(cat)

# Extract tool name and file path; exit silently on parse failure
TOOL_NAME=$(echo "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
FILE_PATH=$(echo "$INPUT" | jq -re '.tool_input.file_path' 2>/dev/null) || exit 0

# Only inject for Edit and Write tool calls
[[ "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "Write" ]] || exit 0

# Resolve paths relative to project root (two levels up from .claude/hooks/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PATTERNS_DIR="$PROJECT_ROOT/docs/patterns"
RULES_DIR="$PROJECT_ROOT/docs/rules"
LEARNINGS_FILE="$PROJECT_ROOT/docs/LEARNINGS.md"

# Map file path to domains
DOMAINS=""
add_domain() {
  case ",$DOMAINS," in
    *,"$1",*) ;;
    *) DOMAINS="${DOMAINS:+$DOMAINS,}$1" ;;
  esac
}

case "$FILE_PATH" in
  */server/routes/*|server/routes/*)
    add_domain api; add_domain security; add_domain architecture ;;
  */server/storage/*|server/storage/*|*/shared/schema.ts|shared/schema.ts|*/migrations/*|migrations/*)
    add_domain database; add_domain security; add_domain architecture ;;
  */server/middleware/*|server/middleware/*)
    add_domain security; add_domain api ;;
  */server/services/photo-analysis.ts|*/server/services/nutrition-coach.ts|*/server/services/recipe-chat.ts|*/server/services/recipe-generation.ts|*/evals/*|server/services/photo-analysis.ts|server/services/nutrition-coach.ts|server/services/recipe-chat.ts|server/services/recipe-generation.ts|evals/*)
    add_domain ai-prompting; add_domain security ;;
  */server/services/*|server/services/*)
    add_domain architecture ;;
  */client/screens/*|*/client/components/*|client/screens/*|client/components/*)
    add_domain react-native; add_domain design-system; add_domain accessibility ;;
  */client/navigation/*|client/navigation/*)
    add_domain react-native; add_domain accessibility ;;
  */client/hooks/*|client/hooks/*)
    add_domain hooks; add_domain client-state; add_domain react-native ;;
  */client/context/*|*/client/lib/*|client/context/*|client/lib/*)
    add_domain client-state ;;
  */client/constants/theme.ts|client/constants/theme.ts|*/design_guidelines.md|design_guidelines.md)
    add_domain design-system ;;
  */__tests__/*|__tests__/*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx)
    add_domain testing ;;
esac

# Always add typescript for .ts/.tsx files
case "$FILE_PATH" in
  *.ts|*.tsx) add_domain typescript ;;
esac

# Exit silently if no domains matched
[ -n "$DOMAINS" ] || exit 0

# Build context in a temp file (avoids subshell newline stripping)
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

printf '=== Pre-write context for %s ===\n' "$FILE_PATH" >> "$TMPFILE"

IFS=',' read -ra DOMAIN_LIST <<< "$DOMAINS"
for DOMAIN in "${DOMAIN_LIST[@]}"; do
  RULES_FILE="$RULES_DIR/${DOMAIN}.md"
  PATTERNS_FILE="$PATTERNS_DIR/${DOMAIN}.md"

  # Inject full rules file (short by design)
  if [ -f "$RULES_FILE" ]; then
    printf '\n[RULES — %s]\n' "$DOMAIN" >> "$TMPFILE"
    cat "$RULES_FILE" >> "$TMPFILE"
  fi

  # Inject first 80 lines of pattern doc
  if [ -f "$PATTERNS_FILE" ]; then
    printf '\n[PATTERNS — %s (excerpt)]\n' "$DOMAIN" >> "$TMPFILE"
    head -80 "$PATTERNS_FILE" >> "$TMPFILE"
  fi
done

# Inject matching learnings (first 20 lines that mention this file's basename)
BASENAME=$(basename "$FILE_PATH")
BASENAME="${BASENAME%.*}"
if [ -f "$LEARNINGS_FILE" ] && [ -n "$BASENAME" ]; then
  printf '\n[LEARNINGS — matches for "%s"]\n' "$BASENAME" >> "$TMPFILE"
  MATCHES=$(grep -i "$BASENAME" "$LEARNINGS_FILE" 2>/dev/null | head -20 || true)
  if [ -n "$MATCHES" ]; then
    printf '%s\n' "$MATCHES" >> "$TMPFILE"
  else
    echo "(none)" >> "$TMPFILE"
  fi
fi

# Output hook response JSON
CONTEXT=$(cat "$TMPFILE")
jq -n --arg ctx "$CONTEXT" \
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":$ctx}}'
