#!/usr/bin/env bash
# Tests for guard-worktree-isolation.sh — run from anywhere.
# The hook only needs `jq` (real); no stubs are required.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/guard-worktree-isolation.sh"
PASS=0; FAIL=0

# Run the hook with $1 as stdin JSON; echo its stdout.
run_hook() { echo "$1" | bash "$HOOK" 2>/dev/null; }

# Assert the hook DENIED: output carries the deny decision.
assert_deny() {
  local name="$1" out
  out=$(run_hook "$2")
  if echo "$out" | grep -q '"permissionDecision": "deny"'; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected a deny decision)"
    echo "  got: $(echo "$out" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

# Assert the hook ALLOWED: no output at all (silent exit 0).
assert_allow() {
  local name="$1" out
  out=$(run_hook "$2")
  if [ -z "$out" ]; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected no output / allow)"
    echo "  got: $(echo "$out" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

WT='/Users/x/projects/OCRecipes/.claude/worktrees/agent-abc'

# The leak signature: in a worktree, absolute path targeting the main checkout.
assert_deny "absolute main-checkout path from inside a worktree is denied" \
  "{\"cwd\":\"$WT\",\"tool_input\":{\"file_path\":\"/Users/x/projects/OCRecipes/server/app.ts\"}}"

# Same, but cwd is a SUBDIRECTORY of the worktree — WT_ROOT must still resolve.
assert_deny "deny still fires when cwd is a worktree subdirectory" \
  "{\"cwd\":\"$WT/server\",\"tool_input\":{\"file_path\":\"/Users/x/projects/OCRecipes/server/app.ts\"}}"

# Allowed: absolute path that stays inside the worktree.
assert_allow "absolute path inside the worktree is allowed" \
  "{\"cwd\":\"$WT\",\"tool_input\":{\"file_path\":\"$WT/server/app.ts\"}}"

# Allowed: relative path (resolves against the in-worktree cwd).
assert_allow "relative path is allowed" \
  "{\"cwd\":\"$WT\",\"tool_input\":{\"file_path\":\"server/app.ts\"}}"

# Allowed: a normal (non-worktree) session — the guard does not act.
assert_allow "non-worktree session is untouched" \
  '{"cwd":"/Users/x/projects/OCRecipes","tool_input":{"file_path":"/Users/x/projects/OCRecipes/server/app.ts"}}'

# Allowed: absolute path entirely outside the repo (e.g. /tmp scratch files).
assert_allow "absolute path outside the repo is allowed" \
  "{\"cwd\":\"$WT\",\"tool_input\":{\"file_path\":\"/tmp/scratch.txt\"}}"

# Fail open: empty MAIN_ROOT (repo at filesystem root) must not deny everything.
assert_allow "empty MAIN_ROOT edge case fails open" \
  '{"cwd":"/.claude/worktrees/agent-abc","tool_input":{"file_path":"/etc/passwd"}}'

# Fail open: malformed JSON input.
assert_allow "malformed JSON fails open" \
  'not json at all'

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
