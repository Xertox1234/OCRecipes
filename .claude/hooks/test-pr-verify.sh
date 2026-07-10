#!/usr/bin/env bash
# Tests for pr-verify.sh — run from project root.
# Hermetic: stubs `gh` on PATH; no real GitHub calls made.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/pr-verify.sh"
PASS=0; FAIL=0

make_stub_gh() {
  local mode="$1"
  local dir
  dir=$(mktemp -d)
  cat > "$dir/gh" <<EOF
#!/usr/bin/env bash
case "$mode" in
  success)
    echo '{"number":42,"url":"https://github.com/x/y/pull/42","state":"OPEN","title":"My PR"}'
    exit 0;;
  fail)
    echo "error: no pull requests found" >&2
    exit 1;;
esac
EOF
  chmod +x "$dir/gh"
  printf '%s' "$dir"
}

run_hook() {
  local cmd="$1" gh_mode="${2:-success}"
  local input stubdir out
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  stubdir=$(make_stub_gh "$gh_mode")
  out=$(echo "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$stubdir"
  printf '%s' "$out"
}

assert_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF "$needle" <<<"$out"; then
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

# Test 1: gh pr create, gh succeeds → verified message with PR number
OUT=$(run_hook "gh pr create --title 'foo' --body 'bar'" "success")
assert_contains "gh pr create + gh succeeds: PR verified message" "PR state verified" "$OUT"
assert_contains "gh pr create + gh succeeds: PR number present" "42" "$OUT"
assert_contains "gh pr create + gh succeeds: URL present" "https://github.com" "$OUT"

# Test 2: gh pr merge succeeds → verified message with PR number
OUT=$(run_hook "gh pr merge 42 --squash --delete-branch" "success")
assert_contains "gh pr merge + gh succeeds: PR verified message" "PR state verified" "$OUT"
assert_contains "gh pr merge + gh succeeds: PR number present" "42" "$OUT"

# Test 2b: gh pr merge, gh fails → warning message
OUT=$(run_hook "gh pr merge 42 --squash" "fail")
assert_contains "gh pr merge + gh fails: warning emitted" "WARNING: could not verify" "$OUT"

# Test 3: non-matching command → silence
OUT=$(run_hook "git status" "success")
assert_silent "git status does not trigger pr-verify" "$OUT"

# Test 4: gh pr view (read, not write) → silence
OUT=$(run_hook "gh pr view 42" "success")
assert_silent "gh pr view (read command) does not trigger pr-verify" "$OUT"

# Test 5: gh pr close → verified message
OUT=$(run_hook "gh pr close 42" "success")
assert_contains "gh pr close triggers pr-verify" "PR state verified" "$OUT"

# Test 6: gh pr edit → verified message
OUT=$(run_hook "gh pr edit 42 --title 'updated title'" "success")
assert_contains "gh pr edit triggers pr-verify" "PR state verified" "$OUT"

# Run the hook against an MCP tool call (no .tool_input.command).
run_hook_mcp() {
  local tool="$1" gh_mode="${2:-success}"
  local input stubdir out
  input=$(jq -n --arg t "$tool" '{"tool_name":$t,"tool_input":{"title":"foo"},"tool_response":{"number":42}}')
  stubdir=$(make_stub_gh "$gh_mode")
  out=$(echo "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$stubdir"
  printf '%s' "$out"
}

# Test 7: MCP create_pull_request → verified message (resolves via gh pr view)
OUT=$(run_hook_mcp "mcp__github__create_pull_request" "success")
assert_contains "MCP create_pull_request triggers pr-verify" "PR state verified" "$OUT"
assert_contains "MCP create_pull_request: PR number present" "42" "$OUT"

# Test 8: a non-PR MCP tool → silence
OUT=$(run_hook_mcp "mcp__github__get_me" "success")
assert_silent "other MCP tool does not trigger pr-verify" "$OUT"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
