#!/usr/bin/env bash
# Tests for worktree-deps.sh — builds a throwaway git repo with a linked
# worktree and asserts the hook symlinks node_modules into it.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/worktree-deps.sh"
PASS=0; FAIL=0

# assert NAME CMD... — CMD must exit 0.
assert() {
  local name="$1"; shift
  if "$@"; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name"; FAIL=$((FAIL+1)); fi
}
# assert_not NAME CMD... — CMD must exit non-zero.
assert_not() {
  local name="$1"; shift
  if "$@"; then echo "FAIL: $name"; FAIL=$((FAIL+1))
  else echo "PASS: $name"; PASS=$((PASS+1)); fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

REPO="$TMP/repo"
mkdir -p "$REPO"
(
  cd "$REPO"
  git init -q
  git config user.email t@example.com
  git config user.name test
  echo '{}' > package.json
  mkdir node_modules && touch node_modules/.marker
  git add package.json && git commit -qm init
)
WT="$REPO/.claude/worktrees/sample"
git -C "$REPO" worktree add -q "$WT" -b sample

# A fresh worktree has no node_modules (the bug this hook fixes).
assert_not "fresh worktree starts without node_modules" test -e "$WT/node_modules"

# Run the hook from inside the worktree (simulates the PostToolUse cwd).
( cd "$WT" && bash "$HOOK" )
assert "hook creates a node_modules symlink" test -L "$WT/node_modules"
assert "symlink resolves to the main checkout's node_modules" test -e "$WT/node_modules/.marker"

# Idempotent: a second run from the main checkout leaves the symlink intact.
( cd "$REPO" && bash "$HOOK" )
assert "re-run keeps the symlink" test -L "$WT/node_modules"

# Fail-open: outside any git repo the hook is a silent no-op.
assert "no-op outside a git repo" bash -c "cd '$TMP' && bash '$HOOK'"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
