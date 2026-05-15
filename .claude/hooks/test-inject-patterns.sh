#!/usr/bin/env bash
# Tests for inject-patterns.sh — run from project root
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/inject-patterns.sh"
SPILL_FILE="/tmp/ocrecipes-injection-context.md"
PASS=0; FAIL=0

# run_hook: clear stale spill, invoke hook, echo stdout+spill combined so callers can grep both.
# Multi-domain matches routinely exceed the 9 KB inline cap and the hook copies overflow to
# $SPILL_FILE — searching both keeps tests assertion-correct without depending on which side
# of the threshold a given input lands on.
run_hook() {
  local input="$1"
  rm -f "$SPILL_FILE"
  local output
  output=$(echo "$input" | bash "$HOOK" 2>/dev/null || true)
  local spill=""
  [ -f "$SPILL_FILE" ] && spill=$(cat "$SPILL_FILE")
  printf '%s\n%s' "$output" "$spill"
}

check() {
  local name="$1" input="$2" pattern="$3"
  local combined
  combined=$(run_hook "$input")
  if echo "$combined" | grep -q "$pattern"; then
    echo "PASS: $name"; PASS=$((PASS + 1))
  else
    echo "FAIL: $name"; echo "  expected to find (in stdout or spill): $pattern"; FAIL=$((FAIL + 1))
  fi
}

check_no_match() {
  local name="$1" input="$2" pattern="$3"
  local combined
  combined=$(run_hook "$input")
  if echo "$combined" | grep -q "$pattern"; then
    echo "FAIL: $name (expected NOT to find: $pattern)"; FAIL=$((FAIL + 1))
  else
    echo "PASS: $name"; PASS=$((PASS + 1))
  fi
}

# check_empty: hook short-circuited entirely (no JSON, no preamble). Used for tools the hook
# rejects (non-Edit/Write) or malformed input. Edit/Write with a valid file_path always emits
# at least the discipline preamble — use check + check_no_match for that case instead.
check_empty() {
  local name="$1" input="$2"
  local output
  rm -f "$SPILL_FILE"
  output=$(echo "$input" | bash "$HOOK" 2>/dev/null || true)
  if [ -z "$output" ]; then
    echo "PASS: $name"; PASS=$((PASS + 1))
  else
    echo "FAIL: $name (expected empty)"; echo "  got: $(echo "$output" | head -3)"; FAIL=$((FAIL + 1))
  fi
}

# server/routes → api + security + architecture + typescript
check "server/routes → api rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — api"

check "server/routes → security rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — security"

check "server/routes → typescript rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — typescript"

check "server/routes → pattern excerpt" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "PATTERNS — api"

# client/screens → react-native + accessibility + design-system
check "client/screens → accessibility rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/screens/HomeScreen.tsx"}}' \
  "RULES — accessibility"

check "client/screens → react-native rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/screens/HomeScreen.tsx"}}' \
  "RULES — react-native"

# server/storage → database
check "server/storage → database rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/storage/recipes.ts"}}' \
  "RULES — database"

# client/hooks → hooks + client-state
check "client/hooks → hooks rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"client/hooks/useRecipes.ts"}}' \
  "RULES — hooks"

# Output is valid JSON
check "output is valid JSON with hookSpecificOutput" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "hookSpecificOutput"

# Read tool → no output (not Edit or Write)
check_empty "Read tool → no output" \
  '{"tool_name":"Read","tool_input":{"file_path":"server/routes/recipes.ts"}}'

# Missing file_path → no output (graceful degradation)
check_empty "missing file_path → no output" \
  '{"tool_name":"Edit","tool_input":{}}'

# File with no domain match → discipline preamble only (no RULES/PATTERNS blocks).
# The hook emits the preamble unconditionally for Edit/Write on a valid file_path so the
# agent always sees the workflow reminders, even when no domain mapping triggers.
check "package.json → discipline preamble emitted" \
  '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}' \
  "DISCIPLINE"

check_no_match "package.json → no domain RULES blocks" \
  '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}' \
  "RULES — "

check_no_match "package.json → no PATTERNS blocks" \
  '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}' \
  "PATTERNS — "

# AI service file must get architecture domain (case exclusivity regression)
check "AI service → architecture rules (additive match)" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/services/photo-analysis.ts"}}' \
  "RULES — architecture"

check "AI service → ai-prompting rules still present" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/services/photo-analysis.ts"}}' \
  "RULES — ai-prompting"

# Test file inside a route directory must get testing domain (case exclusivity regression)
check "route __tests__ file → testing rules (additive match)" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/__tests__/recipes.test.ts"}}' \
  "RULES — testing"

check "route __tests__ file → api rules still present" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/__tests__/recipes.test.ts"}}' \
  "RULES — api"

# client/components/** must include performance per copilot-instructions table
check "client/components → performance rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/components/RecipeCard.tsx"}}' \
  "RULES — performance"

check "client/components → react-native rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/components/RecipeCard.tsx"}}' \
  "RULES — react-native"

# evals/** must map to ai-prompting + testing (no security)
check "evals/** → ai-prompting rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"evals/runner.ts"}}' \
  "RULES — ai-prompting"

check "evals/** → testing rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"evals/runner.ts"}}' \
  "RULES — testing"

check_no_match "evals/** → no security rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"evals/runner.ts"}}' \
  "RULES — security"

# .github/workflows/** → architecture + testing
check ".github/workflows → architecture rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":".github/workflows/ci.yml"}}' \
  "RULES — architecture"

check ".github/workflows → testing rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":".github/workflows/ci.yml"}}' \
  "RULES — testing"

# Root tool configs → testing + typescript (eslint.config.js is not .ts/.tsx,
# so typescript must come from the explicit config rule)
check "eslint.config.js → testing rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"eslint.config.js"}}' \
  "RULES — testing"

check "eslint.config.js → typescript rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"eslint.config.js"}}' \
  "RULES — typescript"

check "vitest.config.ts → testing rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"vitest.config.ts"}}' \
  "RULES — testing"

# AI service must NOT have security as a directly-injected domain — the
# copilot-instructions table maps LLM-touching services to {architecture, ai-prompting} only.
check_no_match "AI service → no security rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/services/photo-analysis.ts"}}' \
  "RULES — security"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
