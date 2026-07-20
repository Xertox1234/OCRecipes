#!/usr/bin/env bash
# Tests for worktree-deps.sh — builds a throwaway git repo with linked
# worktrees and asserts the hook symlinks node_modules into them.
set -uo pipefail

# ${HOOK:-...}: overridable so a pre-fix copy can be tested against this suite
# (the RED-verification recipe in docs/solutions/conventions/
# chmod-000-regression-test-os-may-already-block-guarded-behavior-2026-07-19.md
# depends on this).
HOOK="${HOOK:-$(cd "$(dirname "$0")" && pwd)/worktree-deps.sh}"
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
# chmod before rm: an abort mid-test can leave a mode-000 fixture dir (the
# unreadable case below), which a non-root `rm -rf` refuses to delete.
trap 'chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

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

# The /audit skill's harness-managed root, .worktrees/ (sibling to .claude/worktrees/),
# must also get provisioned.
AUDIT_WT="$REPO/.worktrees/audit-sample"
git -C "$REPO" worktree add -q "$AUDIT_WT" -b audit-sample
assert_not "fresh .worktrees/ tree starts without node_modules" test -e "$AUDIT_WT/node_modules"
( cd "$REPO" && bash "$HOOK" )
assert "hook symlinks node_modules into .worktrees/" test -L "$AUDIT_WT/node_modules"
assert "symlink into .worktrees/ resolves" test -e "$AUDIT_WT/node_modules/.marker"

# A node_modules that exists but holds ONLY tool-cache dot-entries (e.g. vitest
# creating node_modules/.vite/ before the hook ever ran) is not an install — it
# must be replaced with the symlink, or the worktree silently runs against a
# broken dependency tree (bit three /todo executors live on 2026-07-19).
NOISE_WT="$REPO/.claude/worktrees/cache-noise"
git -C "$REPO" worktree add -q "$NOISE_WT" -b cache-noise
mkdir -p "$NOISE_WT/node_modules/.vite/vitest"
touch "$NOISE_WT/node_modules/.vite/vitest/results.json"
( cd "$REPO" && bash "$HOOK" )
assert "cache-noise-only node_modules is replaced by the symlink" test -L "$NOISE_WT/node_modules"
assert "replacement symlink resolves" test -e "$NOISE_WT/node_modules/.marker"

# A REAL install (any non-hidden entry = an actual package) must never be
# clobbered — the replace path applies to dot-entry-only noise exclusively.
REAL_WT="$REPO/.claude/worktrees/real-install"
git -C "$REPO" worktree add -q "$REAL_WT" -b real-install
mkdir -p "$REAL_WT/node_modules/leftpad"
echo 'module.exports = 1' > "$REAL_WT/node_modules/leftpad/index.js"
( cd "$REPO" && bash "$HOOK" )
assert_not "real node_modules install is NOT replaced" test -L "$REAL_WT/node_modules"
assert "real install's package survives the hook" test -f "$REAL_WT/node_modules/leftpad/index.js"

# An existing-but-UNREADABLE node_modules (restrictive permissions, root-owned
# residue) must be left alone, not treated as cache-noise-and-replaced: `find`
# on a directory it cannot read/search also prints nothing, indistinguishable
# from a genuinely empty/dot-only dir by output alone — the hook now gates the
# noise classification on the probe's own exit status instead.
#
# Note: on at least one `rm` implementation (BSD, macOS), `rm -rf` already
# no-ops on a mode-000 directory regardless of this guard, since it can't be
# opened to enumerate (even zero) entries — so this fixture may not go RED
# against the pre-guard hook on every platform/`rm` variant. It still pins
# the desired end state (never symlinked, never removed) and is cheap
# insurance for any environment/rm implementation where that isn't true
# (e.g. running as root, which is why that case is skipped below).
if [ "$(id -u)" = "0" ]; then
  echo "SKIP: unreadable node_modules case — running as root; chmod 000 is bypassed by root, test not meaningful"
else
  UNREADABLE_WT="$REPO/.claude/worktrees/unreadable"
  git -C "$REPO" worktree add -q "$UNREADABLE_WT" -b unreadable
  mkdir -p "$UNREADABLE_WT/node_modules"
  chmod 000 "$UNREADABLE_WT/node_modules"
  ( cd "$REPO" && bash "$HOOK" )
  assert_not "unreadable node_modules is NOT symlinked" test -L "$UNREADABLE_WT/node_modules"
  chmod 755 "$UNREADABLE_WT/node_modules"
  assert "unreadable node_modules is NOT removed (still a real dir)" test -d "$UNREADABLE_WT/node_modules"
fi

# An EMPTY node_modules with partial permissions (mode 644: readable, not
# searchable). Whether `find` can prove it empty is PLATFORM-DEPENDENT (BSD
# find refuses without the x bit; some implementations succeed when there are
# no entries to stat), so pin the platform-appropriate outcome of the
# probe-status gate: probe inspectable → healed to the symlink; probe refused →
# left alone entirely. Either way the invariant holds: never removed without a
# symlink taking its place. Probe BEFORE the hook run — the hook may replace
# the dir, changing what the probe would see.
LOWMODE_WT="$REPO/.claude/worktrees/lowmode"
git -C "$REPO" worktree add -q "$LOWMODE_WT" -b lowmode
mkdir -p "$LOWMODE_WT/node_modules"
chmod 644 "$LOWMODE_WT/node_modules"
if find "$LOWMODE_WT/node_modules" -mindepth 1 -maxdepth 1 -not -name '.*' -print -quit >/dev/null 2>&1; then
  LOWMODE_INSPECTABLE=1
else
  LOWMODE_INSPECTABLE=0
fi
( cd "$REPO" && bash "$HOOK" )
if [ "$LOWMODE_INSPECTABLE" = "1" ]; then
  assert "empty mode-644 node_modules is healed to the symlink (probe inspectable here)" test -L "$LOWMODE_WT/node_modules"
  assert "healed mode-644 symlink resolves" test -e "$LOWMODE_WT/node_modules/.marker"
else
  assert_not "mode-644 node_modules is NOT symlinked (probe refused here)" test -L "$LOWMODE_WT/node_modules"
  assert "mode-644 node_modules is NOT removed (still a real dir)" test -d "$LOWMODE_WT/node_modules"
fi

# A worktree outside both harness-managed roots (a user's own ad hoc `git worktree
# add`) must NOT get a node_modules symlink — that scope boundary is deliberate.
ADHOC_WT="$REPO/adhoc-sample"
git -C "$REPO" worktree add -q "$ADHOC_WT" -b adhoc-sample
( cd "$REPO" && bash "$HOOK" )
assert_not "ad hoc worktree outside both roots is NOT symlinked" test -e "$ADHOC_WT/node_modules"

# Fail-open: outside any git repo the hook is a silent no-op.
assert "no-op outside a git repo" bash -c "cd '$TMP' && bash '$HOOK'"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
