#!/usr/bin/env bash
# Tests for lsp-nudge.sh — run from project root.
# Hermetic: the only side-channel is the per-session throttle file in /tmp,
# which each case isolates with a unique session_id (and cleans up after).
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/lsp-nudge.sh"
PASS=0; FAIL=0

# Run the hook with a command + a (unique) session id. Cleans the throttle
# state for that session so cases never cross-contaminate via the /tmp file.
run_hook() {
  local cmd="$1" session="${2:-test-$RANDOM-$RANDOM}"
  local input out
  input=$(jq -n --arg c "$cmd" --arg s "$session" \
    '{"tool_name":"Bash","tool_input":{"command":$c},"session_id":$s}')
  out=$(printf '%s' "$input" | bash "$HOOK" 2>/dev/null)
  rm -f "/tmp/ocrecipes-lsp-nudge-${session}" 2>/dev/null
  printf '%s' "$out"
}

assert_contains() {
  local name="$1" needle="$2" out="$3"
  if printf '%s' "$out" | grep -qF "$needle"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected substring: $needle)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

assert_silent() {
  local name="$1" out="$2"
  if [ -z "$out" ]; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected silence)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

# --- True positives: real symbol searches → nudge fires ---
OUT=$(run_hook "grep -rn \"getUserByEmail\" server")
assert_contains "camelCase symbol nudges" "prefer the LSP" "$OUT"

OUT=$(run_hook "grep -rn \"ScannedItemResponse\" client")
assert_contains "PascalCase symbol nudges" "prefer the LSP" "$OUT"

OUT=$(run_hook "grep -rn \"isUniqueViolation\" server")
assert_contains "nudge names the pattern" "isUniqueViolation" "$OUT"

# --- False positives that the fix must silence ---
# SCREAMING_SNAKE env-vars / constants: grep is the right tool, LSP adds nothing.
OUT=$(run_hook "grep -rn \"DATABASE_URL\" server")
assert_silent "SCREAMING_SNAKE env-var is silent" "$OUT"

OUT=$(run_hook "grep -rn \"JWT_SECRET\" server")
assert_silent "SCREAMING_SNAKE secret is silent" "$OUT"

OUT=$(run_hook "grep -rn \"RESEND_API_KEY\" server")
assert_silent "SCREAMING_SNAKE multi-underscore is silent" "$OUT"

# Dunder directory / convention names are not symbols.
OUT=$(run_hook "grep -rn \"__tests__\" client")
assert_silent "dunder name is silent" "$OUT"

# --- Existing guards stay intact ---
OUT=$(run_hook "grep -Fn \"getUserByEmail\" server")
assert_silent "fixed-string (-F) is silent" "$OUT"

OUT=$(run_hook "grep -rn \"get.*Email\" server")
assert_silent "regex metacharacters are silent" "$OUT"

OUT=$(run_hook "ls -la server")
assert_silent "non-grep command is silent" "$OUT"

OUT=$(run_hook "grep -n \"getUserByEmail\" README.md")
assert_silent "non-TypeScript target is silent" "$OUT"

# --- Throttle: same pattern twice in one session fires once ---
SID="throttle-$RANDOM-$RANDOM"
FIRST=$(printf '%s' "$(jq -n --arg c 'grep -rn "serializeUser" server' --arg s "$SID" \
  '{"tool_name":"Bash","tool_input":{"command":$c},"session_id":$s}')" | bash "$HOOK" 2>/dev/null)
SECOND=$(printf '%s' "$(jq -n --arg c 'grep -rn "serializeUser" server' --arg s "$SID" \
  '{"tool_name":"Bash","tool_input":{"command":$c},"session_id":$s}')" | bash "$HOOK" 2>/dev/null)
rm -f "/tmp/ocrecipes-lsp-nudge-${SID}" 2>/dev/null
assert_contains "throttle: first nudge fires" "prefer the LSP" "$FIRST"
assert_silent "throttle: second nudge is silent" "$SECOND"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
