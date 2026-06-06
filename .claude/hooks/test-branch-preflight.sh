#!/usr/bin/env bash
# Tests for branch-preflight.sh — run from project root.
# Hermetic: uses a temp git repo; no external tools needed beyond git + jq.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/branch-preflight.sh"
PASS=0; FAIL=0

run_hook() {
  local cmd="$1"
  local input
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  echo "$input" | bash "$HOOK" 2>/dev/null
}

assert_deny() {
  local name="$1" out="$2"
  if printf '%s' "$out" | grep -q '"permissionDecision": "deny"'; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected deny)"
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

# Set up a temp git repo
REPO=$(mktemp -d)
trap 'rm -rf "$REPO"' EXIT
git -C "$REPO" init -q
git -C "$REPO" config user.email "t@t"
git -C "$REPO" config user.name "T"
echo "x" > "$REPO/x.txt"
git -C "$REPO" add x.txt
git -C "$REPO" commit -q -m "init"
INITIAL_BRANCH=$(git -C "$REPO" symbolic-ref --short HEAD 2>/dev/null || echo "main")

export GIT_DIR="$REPO/.git"
export GIT_WORK_TREE="$REPO"

# Test 1: on main → silent (enforce_admins off; owner pushes to main directly)
OUT=$(run_hook "git commit -m 'ok'")
assert_silent "commit on main is allowed" "$OUT"

# Test 3: detached HEAD → deny, message mentions the detached state
git -C "$REPO" checkout --detach HEAD -q 2>/dev/null
OUT=$(run_hook "git commit -m 'oops'")
assert_deny "commit on detached HEAD is denied" "$OUT"
if printf '%s' "$OUT" | grep -qi "detached"; then
  echo "PASS: deny message mentions detached HEAD"; PASS=$((PASS+1))
else
  echo "FAIL: deny message should mention detached HEAD"
  FAIL=$((FAIL+1))
fi

# Test 4: feature branch → silent
git -C "$REPO" switch -c fix/my-feature -q 2>/dev/null
OUT=$(run_hook "git commit -m 'ok'")
assert_silent "commit on feature branch is silent" "$OUT"

# Test 5: non-commit command on main → silent
git -C "$REPO" switch "$INITIAL_BRANCH" -q 2>/dev/null
OUT=$(run_hook "git status")
assert_silent "non-commit command is silent even on main" "$OUT"

# Test 6: SKIP_BRANCH_PREFLIGHT=1 on main → silent
OUT=$(SKIP_BRANCH_PREFLIGHT=1 run_hook "git commit -m 'skip'")
assert_silent "SKIP_BRANCH_PREFLIGHT=1 bypasses deny on main" "$OUT"

# Test 7: outside a git repo → silent (fail-open)
OUT=$(env -u GIT_DIR -u GIT_WORK_TREE bash -c 'cd /tmp && echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m test\"}}" | bash "$1" 2>/dev/null' _ "$HOOK")
assert_silent "outside a git repo fails open (silent)" "$OUT"

# Test 8: compound form (git add && git commit) on detached HEAD → deny
export GIT_DIR="$REPO/.git"
export GIT_WORK_TREE="$REPO"
git -C "$REPO" checkout --detach HEAD -q 2>/dev/null
OUT=$(run_hook "git add -A && git commit -m 'oops'")
assert_deny "compound 'git add && git commit' on detached HEAD is denied" "$OUT"

unset GIT_DIR GIT_WORK_TREE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
