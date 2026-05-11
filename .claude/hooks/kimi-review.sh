#!/usr/bin/env bash
# PreToolUse hook for Bash — when the about-to-run command is a `git commit`,
# run kimi-review over the staged diff and surface findings as additionalContext.
# Reads tool event JSON from stdin; exits 0 silently otherwise.

# Short-circuit unless the pending Bash command is a `git commit`.
jq -re '.tool_input.command | select(test("git( .+)? commit"))' >/dev/null 2>&1 || exit 0

FILES=$(git diff --cached --name-only)
[ -n "$FILES" ] || exit 0

PATTERNS=''
add_pattern() {
  case ",$PATTERNS," in
    *,$1,*) ;;
    *) PATTERNS="${PATTERNS:+$PATTERNS,}$1" ;;
  esac
}

while IFS= read -r file; do
  case "$file" in
    server/routes/*)
      add_pattern api; add_pattern security; add_pattern architecture ;;
    server/storage/*|shared/schema.ts|migrations/*)
      add_pattern database; add_pattern security; add_pattern architecture ;;
    server/middleware/*)
      add_pattern security; add_pattern api ;;
    server/services/photo-analysis.ts|server/services/nutrition-coach.ts|server/services/recipe-chat.ts|server/services/recipe-generation.ts|evals/*)
      add_pattern ai-prompting; add_pattern security; add_pattern testing ;;
    server/services/*)
      add_pattern architecture ;;
    client/screens/*|client/components/*|client/navigation/*)
      add_pattern react-native; add_pattern design-system; add_pattern accessibility; add_pattern performance ;;
    client/hooks/*)
      add_pattern hooks; add_pattern client-state; add_pattern react-native; add_pattern accessibility ;;
    client/context/*|client/lib/query-client.ts|client/lib/token-storage.ts)
      add_pattern client-state ;;
    client/constants/theme.ts|design_guidelines.md)
      add_pattern design-system ;;
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*/__tests__/*)
      add_pattern testing ;;
  esac
  case "$file" in
    *.ts|*.tsx) add_pattern typescript ;;
  esac
done <<< "$FILES"

if [ -n "$PATTERNS" ]; then
  REVIEW=$(git diff --cached | kimi-review --scope "staged for commit" --profile ocrecipes --patterns "$PATTERNS" --rules "$PATTERNS" 2>&1)
else
  REVIEW=$(git diff --cached | kimi-review --scope "staged for commit" --profile ocrecipes 2>&1)
fi

jq -n --arg r "$REVIEW" --arg p "$PATTERNS" \
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":((if ($p | length) > 0 then "kimi-review patterns: " + $p + "\n" else "" end) + "kimi-review findings (check for CRITICAL before proceeding):\n" + $r)}}' \
  2>/dev/null || true
