#!/usr/bin/env bash
# Tests for inject-patterns.sh — run from project root
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/inject-patterns.sh"
PASS=0; FAIL=0

check() {
  local name="$1" input="$2" pattern="$3"
  local output
  output=$(echo "$input" | bash "$HOOK" 2>/dev/null || true)
  if echo "$output" | grep -q "$pattern"; then
    echo "PASS: $name"; PASS=$((PASS + 1))
  else
    echo "FAIL: $name"; echo "  expected to find: $pattern"; FAIL=$((FAIL + 1))
  fi
}

check_empty() {
  local name="$1" input="$2"
  local output
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

check "server/routes → pattern excerpt" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "PATTERNS — api"

# typescript domain is suppressed when any more-specific domain matched (option (a)
# from todos/archive/2026-05-12-pattern-injection-spill-on-multi-domain-edits.md).
# Keeps the 4-domain stack under the 9000-byte spill threshold.
check_not() {
  local name="$1" input="$2" pattern="$3"
  local output
  output=$(echo "$input" | bash "$HOOK" 2>/dev/null || true)
  if echo "$output" | grep -q "$pattern"; then
    echo "FAIL: $name (pattern '$pattern' should be absent)"; FAIL=$((FAIL + 1))
  else
    echo "PASS: $name"; PASS=$((PASS + 1))
  fi
}

check_not "server/routes → typescript rules suppressed (more-specific domain matched)" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — typescript"

# typescript remains the fallback for .ts/.tsx files that match no other domain
check "shared/types.ts → typescript rules (fallback when no other domain matched)" \
  '{"tool_name":"Edit","tool_input":{"file_path":"shared/types.ts"}}' \
  "RULES — typescript"

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

# File with no domain match → no output
check_empty "package.json → no output" \
  '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}'

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

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
