#!/usr/bin/env bash
# Tests for git-safety.sh — run from anywhere. Uses a fake `gh` on PATH and a
# hand-built registry; real git only for the write-shape fixture.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/git-safety.sh"
PASS=0; FAIL=0

run_hook() { echo "$1" | bash "$HOOK" 2>/dev/null; }

assert_deny() {
  local name="$1" out; out=$(run_hook "$2")
  if echo "$out" | grep -q '"permissionDecision": "deny"'; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected deny)"; echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
  fi
}
assert_allow() {
  local name="$1" out; out=$(run_hook "$2")
  if [ -z "$out" ]; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name (expected no output)"; echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1)); fi
}
# Advisor must WARN (additionalContext containing $3) and must NOT deny.
assert_warn_contains() {
  local name="$1" out; out=$(run_hook "$2")
  if echo "$out" | grep -q '"permissionDecision"'; then
    echo "FAIL: $name (advisor must never block)"; FAIL=$((FAIL+1)); return
  fi
  if echo "$out" | grep -q '"additionalContext"' && echo "$out" | grep -qF "$3"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected additionalContext containing: $3)"
    echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
  fi
}

json() {  # $1=session $2=cwd $3=command
  printf '{"tool_name":"Bash","session_id":"%s","cwd":"%s","tool_input":{"command":"%s"}}' "$1" "$2" "$3"
}

# ---------- fake gh ----------
FAKE_BIN=$(mktemp -d)
cat > "$FAKE_BIN/gh" <<'EOF'
#!/usr/bin/env bash
if [ "${FAKE_GH_EXIT:-0}" != "0" ]; then
  echo "${FAKE_GH_STDERR:-no pull requests found}" >&2
  exit "$FAKE_GH_EXIT"
fi
printf '{"number":520,"state":"%s","mergedAt":"2026-07-16T00:00:00Z"}\n' "${FAKE_GH_STATE:-MERGED}"
exit 0
EOF
chmod +x "$FAKE_BIN/gh"
export PATH="$FAKE_BIN:$PATH"

# ---------- registry fixtures ----------
SESSION="test-gitsafety-$$"
REG_DIR="/tmp/claude-worktree-contracts-$SESSION"
WT_A='/Users/x/projects/OCRecipes/.claude/worktrees/agent-aaa'
MAIN='/Users/x/projects/OCRecipes'
mkdir -p "$REG_DIR"
printf '%s' "$WT_A" > "$REG_DIR/aaaa000000000001"
NEST_TMP=""
cleanup() { rm -rf "$REG_DIR" "$FAKE_BIN" ${NEST_TMP:+"$NEST_TMP"}; }
trap cleanup EXIT

# ---------- fast path / no-op ----------
assert_allow "plain command with no registry is silent" \
  "$(json no-registry-session "$MAIN" 'echo hi')"
assert_allow "mutating git with NO registry is allowed (fallback is the file guard's job)" \
  "$(json no-registry-session "$MAIN" 'git commit -m x')"

# ---------- contract branch: mutating git ----------
assert_deny "registry: git commit with main-checkout cwd is denied" \
  "$(json "$SESSION" "$MAIN" 'git commit -m x')"
assert_deny "registry: git mv with main-checkout cwd is denied (the incident)" \
  "$(json "$SESSION" "$MAIN" 'git mv a.ts b.ts')"
assert_allow "registry: git commit inside the registered worktree is allowed" \
  "$(json "$SESSION" "$WT_A" 'git commit -m x')"
assert_allow "registry: git -C <worktree> commit from main cwd is allowed" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A commit -m x")"
assert_deny "registry: git -C <main> commit from worktree cwd is denied" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN commit -m x")"
assert_allow "registry: read-only git anywhere is allowed" \
  "$(json "$SESSION" "$MAIN" 'git status && git diff HEAD')"
assert_allow "registry: git in /tmp scratch repo is allowlisted" \
  "$(json "$SESSION" '/tmp/scratch-repo' 'git commit -m probe')"

# Bypass.
out=$(echo "$(json "$SESSION" "$MAIN" 'git commit -m x')" | SKIP_WORKTREE_CONTRACT=1 bash "$HOOK" 2>/dev/null)
if [ -z "$out" ]; then echo "PASS: SKIP_WORKTREE_CONTRACT=1 bypasses contract branch"; PASS=$((PASS+1));
else echo "FAIL: SKIP_WORKTREE_CONTRACT=1 bypasses contract branch"; FAIL=$((FAIL+1)); fi

# ---------- contract branch: write-shaped commands (real git for MAIN_ROOT) ----------
# pwd -P for the same macOS symlink reason as in test-guard-worktree-isolation.sh.
NEST_TMP=$(cd "$(mktemp -d)" && pwd -P)
(
  cd "$NEST_TMP"
  git init -q main && cd main
  git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init
  git worktree add -q ".claude/worktrees/agent-real"
) >/dev/null 2>&1
R_MAIN="$NEST_TMP/main"
R_WT="$R_MAIN/.claude/worktrees/agent-real"
printf '%s' "$R_WT" > "$REG_DIR/dddd000000000004"

assert_deny "registry: redirect into the main checkout is denied" \
  "$(json "$SESSION" "$R_WT" "echo x > $R_MAIN/notes.txt")"
assert_deny "registry: sed -i on a main-checkout file is denied" \
  "$(json "$SESSION" "$R_WT" "sed -i '' s/a/b/ $R_MAIN/server/app.ts")"
assert_allow "registry: redirect inside the registered worktree is allowed" \
  "$(json "$SESSION" "$R_WT" "echo x > $R_WT/notes.txt")"
assert_allow "registry: redirect to /tmp is allowed" \
  "$(json "$SESSION" "$R_WT" 'echo x > /tmp/scratch.txt')"
rm -f "$REG_DIR/dddd000000000004"

# ---------- advisor branch (fires with or without a registry) ----------
FAKE_GH_STATE=MERGED assert_warn_contains "advisor: branch -D with MERGED PR reports safe" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "MERGED"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: branch -D with OPEN PR warns loudly" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "OPEN and NOT merged"
FAKE_GH_STATE=CLOSED assert_warn_contains "advisor: CLOSED-unmerged PR is a rejection signal" \
  "$(json no-registry-session "$MAIN" 'git push origin --delete todo/foo')" \
  "CLOSED WITHOUT MERGE"
FAKE_GH_EXIT=1 assert_warn_contains "advisor: no PR found warns about never-pushed work" \
  "$(json no-registry-session "$MAIN" 'git branch -D scratch-branch')" \
  "NO PR found"
FAKE_GH_EXIT=8 FAKE_GH_STDERR="network down" assert_warn_contains "advisor: gh hard failure reports UNVERIFIED" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "UNVERIFIED"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close is matched" \
  "$(json no-registry-session "$MAIN" 'gh pr close 520')" \
  "OPEN and NOT merged"
assert_warn_contains "advisor: worktree remove --force warns about uncommitted work" \
  "$(json no-registry-session "$MAIN" 'git worktree remove --force .claude/worktrees/agent-x')" \
  "uncommitted"

# Non-destructive gh/git stays silent.
assert_allow "advisor: gh pr view is not matched" \
  "$(json no-registry-session "$MAIN" 'gh pr view 520')"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
