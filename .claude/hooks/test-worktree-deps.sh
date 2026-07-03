#!/usr/bin/env bash
# Tests for worktree-deps.sh — builds a throwaway git repo with linked
# worktrees and asserts the hook symlinks node_modules into them.
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
  # Gitignored, local-only sources: created in the main checkout but never
  # committed, so a fresh worktree does not get them (the bug this hook fixes).
  mkdir -p docs && printf 'learnings\n' > docs/LEARNINGS.md
  git add package.json && git commit -qm init
)
WT="$REPO/.claude/worktrees/sample"
git -C "$REPO" worktree add -q "$WT" -b sample

# A fresh worktree has none of the gitignored sources (the bug this hook fixes).
assert_not "fresh worktree starts without node_modules" test -e "$WT/node_modules"
assert_not "fresh worktree starts without docs/LEARNINGS.md" test -e "$WT/docs/LEARNINGS.md"

# Run the hook from inside the worktree (simulates the PostToolUse cwd).
( cd "$WT" && bash "$HOOK" )
assert "hook creates a node_modules symlink" test -L "$WT/node_modules"
assert "symlink resolves to the main checkout's node_modules" test -e "$WT/node_modules/.marker"
assert "hook symlinks docs/LEARNINGS.md" test -L "$WT/docs/LEARNINGS.md"
assert "docs/LEARNINGS.md symlink resolves" test -e "$WT/docs/LEARNINGS.md"

# Idempotent: a second run from the main checkout leaves the symlink intact.
( cd "$REPO" && bash "$HOOK" )
assert "re-run keeps the symlink" test -L "$WT/node_modules"

# Worktree whose name contains a slash sits deeper than one level — git
# enumeration must still find it where a `*/` glob would not.
NESTED="$REPO/.claude/worktrees/group/deep"
git -C "$REPO" worktree add -q "$NESTED" -b deep
( cd "$REPO" && bash "$HOOK" )
assert "nested-name worktree is symlinked" test -L "$NESTED/node_modules"
assert "nested-name symlink resolves" test -e "$NESTED/node_modules/.marker"

# A stale/dangling symlink left by an earlier run is replaced, not skipped.
STALE="$REPO/.claude/worktrees/stale"
git -C "$REPO" worktree add -q "$STALE" -b stale
ln -s /nonexistent/node_modules "$STALE/node_modules"
assert_not "precondition: dangling symlink does not resolve" test -e "$STALE/node_modules"
( cd "$REPO" && bash "$HOOK" )
assert "dangling symlink is repaired" test -e "$STALE/node_modules/.marker"

# Fail-open: outside any git repo the hook is a silent no-op.
assert "no-op outside a git repo" bash -c "cd '$TMP' && bash '$HOOK'"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
