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

# Independent if-blocks so multiple rows can match the same path (e.g. AI service + services + test)
[[ "$FILE_PATH" == */server/routes/* || "$FILE_PATH" == server/routes/* ]] && \
  { add_domain api; add_domain security; add_domain architecture; }

[[ "$FILE_PATH" == */server/storage/* || "$FILE_PATH" == server/storage/* || \
   "$FILE_PATH" == */shared/schema.ts  || "$FILE_PATH" == shared/schema.ts  || \
   "$FILE_PATH" == */migrations/*      || "$FILE_PATH" == migrations/* ]] && \
  { add_domain database; add_domain security; add_domain architecture; }

[[ "$FILE_PATH" == */server/middleware/* || "$FILE_PATH" == server/middleware/* ]] && \
  { add_domain security; add_domain api; }

[[ "$FILE_PATH" == */server/services/photo-analysis.ts   || \
   "$FILE_PATH" == */server/services/nutrition-coach.ts  || \
   "$FILE_PATH" == */server/services/recipe-chat.ts      || \
   "$FILE_PATH" == */server/services/recipe-generation.ts || \
   "$FILE_PATH" == server/services/photo-analysis.ts     || \
   "$FILE_PATH" == server/services/nutrition-coach.ts    || \
   "$FILE_PATH" == server/services/recipe-chat.ts        || \
   "$FILE_PATH" == server/services/recipe-generation.ts  || \
   "$FILE_PATH" == */evals/* || "$FILE_PATH" == evals/* ]] && \
  { add_domain ai-prompting; add_domain security; }

# All server/services get architecture (including the AI ones above)
[[ "$FILE_PATH" == */server/services/* || "$FILE_PATH" == server/services/* ]] && \
  add_domain architecture

[[ "$FILE_PATH" == */client/screens/*     || "$FILE_PATH" == client/screens/*     || \
   "$FILE_PATH" == */client/components/*  || "$FILE_PATH" == client/components/* ]] && \
  { add_domain react-native; add_domain design-system; add_domain accessibility; }

[[ "$FILE_PATH" == */client/navigation/* || "$FILE_PATH" == client/navigation/* ]] && \
  { add_domain react-native; add_domain accessibility; }

[[ "$FILE_PATH" == */client/hooks/* || "$FILE_PATH" == client/hooks/* ]] && \
  { add_domain hooks; add_domain client-state; add_domain react-native; }

[[ "$FILE_PATH" == */client/context/* || "$FILE_PATH" == client/context/* || \
   "$FILE_PATH" == */client/lib/*     || "$FILE_PATH" == client/lib/* ]] && \
  add_domain client-state

[[ "$FILE_PATH" == */client/constants/theme.ts || "$FILE_PATH" == client/constants/theme.ts || \
   "$FILE_PATH" == */design_guidelines.md      || "$FILE_PATH" == design_guidelines.md ]] && \
  add_domain design-system

# Test files accumulate testing domain regardless of their enclosing directory
[[ "$FILE_PATH" == */__tests__/* || "$FILE_PATH" == __tests__/* || \
   "$FILE_PATH" == *.test.ts     || "$FILE_PATH" == *.test.tsx  || \
   "$FILE_PATH" == *.spec.ts     || "$FILE_PATH" == *.spec.tsx ]] && \
  add_domain testing

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
