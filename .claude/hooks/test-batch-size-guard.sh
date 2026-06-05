#!/usr/bin/env bash
# Tests for batch-size-guard.sh — run from project root.
# Hermetic: no git, no network. Manipulates /tmp files directly.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/batch-size-guard.sh"
PASS=0; FAIL=0

# Each test uses a unique temp file to avoid cross-test contamination.
make_batch_file() { mktemp /tmp/claude-bash-batch-test-XXXXXX; }

run_hook() {
  local batch_file="$1" cmd="${2:-git status}"
  local input
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  echo "$input" | BATCH_FILE_OVERRIDE="$batch_file" bash "$HOOK" 2>/dev/null
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

# Test 1: burst — 5 timestamps in the same second → warn
F1=$(make_batch_file)
T1=$(date +%s)
for _ in 1 2 3 4 5; do echo "$T1" >> "$F1"; done
OUT=$(run_hook "$F1")
assert_contains "burst of 5 emits batch-size warning" "Batch-size warning" "$OUT"
rm -f "$F1"

# Test 2: under threshold — 2 recent timestamps → silent
F2=$(make_batch_file)
T2=$(date +%s)
echo "$T2" >> "$F2"
echo "$T2" >> "$F2"
OUT=$(run_hook "$F2")
assert_silent "2 recent calls is silent" "$OUT"
rm -f "$F2"

# Test 3: old entries trimmed — 5 entries at now-20 + 1 recent → silent + file trimmed
F3=$(make_batch_file)
T3=$(date +%s)
OLD=$((T3 - 20))
for _ in 1 2 3 4 5; do echo "$OLD" >> "$F3"; done
echo "$T3" >> "$F3"
OUT=$(run_hook "$F3")
assert_silent "5 old + 1 recent is silent (old trimmed)" "$OUT"
# Verify trim: only 1 line should remain (the recent one, plus the one appended by hook run)
LINE_COUNT=$(wc -l < "$F3")
if [ "$LINE_COUNT" -le 2 ]; then
  echo "PASS: old lines were trimmed (line count: $LINE_COUNT)"; PASS=$((PASS+1))
else
  echo "FAIL: expected trim to leave ≤2 lines, got $LINE_COUNT"
  FAIL=$((FAIL+1))
fi
rm -f "$F3"

# Test 4: cold start (no file) → silent, no crash
F4="/tmp/claude-bash-batch-test-nonexistent-$$"
rm -f "$F4"
OUT=$(run_hook "$F4")
assert_silent "cold start (no file) is silent" "$OUT"
rm -f "$F4"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
