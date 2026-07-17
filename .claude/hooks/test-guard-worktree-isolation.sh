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

# Fail open: malformed JSON envelope — the session (and thus registry) is
# unknowable, so this falls through to fallback mode and allows.
assert_allow "malformed JSON envelope fails open (fallback mode)" \
  'not json at all'

# ---------- REGISTRY MODE ----------
SESSION="test-guard-$$"
REG_DIR="/tmp/claude-worktree-contracts-$SESSION"
WT_A='/Users/x/projects/OCRecipes/.claude/worktrees/agent-aaa'
WT_B='/Users/x/projects/OCRecipes/.claude/worktrees/agent-bbb'
MAIN='/Users/x/projects/OCRecipes'
cleanup_registry() { rm -rf "$REG_DIR"; }
trap cleanup_registry EXIT
mkdir -p "$REG_DIR"
printf '%s' "$WT_A" > "$REG_DIR/aaaa000000000001"
printf '%s' "$WT_B" > "$REG_DIR/bbbb000000000002"

# THE incident: cwd is the main checkout while an assignment is active.
assert_deny "registry: main-checkout write while assignment active is denied" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"$MAIN/server/app.ts\"}}"

assert_deny "registry: RELATIVE path resolving into the main checkout is denied" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"server/app.ts\"}}"

assert_allow "registry: write inside worktree A is allowed" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$WT_A\",\"tool_input\":{\"file_path\":\"$WT_A/server/app.ts\"}}"

# Concurrency: entry B must not poison agent A's legitimate writes, and vice versa.
assert_allow "registry: concurrent worktree B write is allowed (no cross-contamination)" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$WT_B\",\"tool_input\":{\"file_path\":\"$WT_B/client/App.tsx\"}}"

assert_allow "registry: relative path inside a registered worktree is allowed" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$WT_A\",\"tool_input\":{\"file_path\":\"server/app.ts\"}}"

assert_allow "registry: /tmp allowlist" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"/tmp/scratch.txt\"}}"

assert_allow "registry: ~/.claude allowlist" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"$HOME/.claude/plans/x.md\"}}"

# NotebookEdit uses notebook_path — must be covered too.
assert_deny "registry: notebook_path into the main checkout is denied" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"notebook_path\":\"$MAIN/analysis.ipynb\"}}"

# Malformed entry (relative content) → fail closed.
printf '%s' 'not-absolute' > "$REG_DIR/cccc000000000003"
assert_deny "registry: malformed entry fails closed" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$WT_A\",\"tool_input\":{\"file_path\":\"$WT_A/server/app.ts\"}}"
rm -f "$REG_DIR/cccc000000000003"

# Bypass.
out=$(echo "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"$MAIN/server/app.ts\"}}" \
  | SKIP_WORKTREE_CONTRACT=1 bash "$HOOK" 2>/dev/null)
if [ -z "$out" ]; then echo "PASS: SKIP_WORKTREE_CONTRACT=1 bypasses"; PASS=$((PASS+1));
else echo "FAIL: SKIP_WORKTREE_CONTRACT=1 bypasses"; FAIL=$((FAIL+1)); fi

cleanup_registry

# ---------- FALLBACK MODE: nested-worktree fixture (real git) ----------
# A worktree nested inside another worktree defeated the old sed path math
# (MAIN_ROOT resolved to the OUTER worktree, so a main-checkout write was allowed).
# The --git-common-dir derivation must deny it.
# pwd -P: use the PHYSICAL path — macOS mktemp returns /var/folders/... (symlinked),
# but git reports /private/var/..., and the hook compares prefixes literally.
NEST_TMP=$(cd "$(mktemp -d)" && pwd -P)
trap 'cleanup_registry; rm -rf "$NEST_TMP"' EXIT
(
  cd "$NEST_TMP"
  git init -q main
  cd main
  git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init
  git worktree add -q ".claude/worktrees/agent-outer"
  cd ".claude/worktrees/agent-outer"
  git worktree add -q ".claude/worktrees/agent-inner"   # relative path → nests on disk
) >/dev/null 2>&1
NEST_MAIN="$NEST_TMP/main"
NEST_INNER="$NEST_MAIN/.claude/worktrees/agent-outer/.claude/worktrees/agent-inner"
assert_deny "fallback: nested worktree cannot write to the TRUE main checkout" \
  "{\"cwd\":\"$NEST_INNER\",\"tool_input\":{\"file_path\":\"$NEST_MAIN/server/app.ts\"}}"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
