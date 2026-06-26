#!/usr/bin/env bash
# Tests for core-bare-guard.sh — run from project root.
# Hermetic: clears inherited git env (the todos P2 lesson) + uses a throwaway temp repo.
set -uo pipefail

# An inherited absolute GIT_DIR would hijack the temp-repo setup onto the real repo (the very
# bug this guard family addresses). Clear it up front; never touch the user's real git config.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
CALLER_STATUS_BEFORE=$(git status --porcelain 2>/dev/null || true)

HOOK="$(cd "$(dirname "$0")" && pwd)/core-bare-guard.sh"
PASS=0; FAIL=0

run_hook() {
  local cmd="$1" input
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  echo "$input" | bash "$HOOK" 2>/dev/null
}

# --- temp repo with a work tree + an initial commit ---
REPO=$(mktemp -d)
trap 'rm -rf "$REPO"' EXIT
git -C "$REPO" init -q
git -C "$REPO" config user.email "test@test"
git -C "$REPO" config user.name "Test"
echo "init" > "$REPO/init.txt"
git -C "$REPO" add init.txt
git -C "$REPO" commit -q -m init

export GIT_DIR="$REPO/.git"
export GIT_WORK_TREE="$REPO"

# Test 1: core.bare=true + a git command → hook resets it AND notes the correction
git config core.bare true
OUT=$(run_hook "git status")
[ "$(git config --bool core.bare)" = "false" ] \
  && { echo "PASS: core.bare reset to false"; PASS=$((PASS+1)); } \
  || { echo "FAIL: core.bare not reset"; FAIL=$((FAIL+1)); }
printf '%s' "$OUT" | grep -q "Auto-corrected core.bare" \
  && { echo "PASS: emits correction note"; PASS=$((PASS+1)); } \
  || { echo "FAIL: no correction note"; FAIL=$((FAIL+1)); }

# Test 2: core.bare already false → silent (no per-call noise)
OUT=$(run_hook "git commit -m x")
[ -z "$OUT" ] \
  && { echo "PASS: silent when core.bare already false"; PASS=$((PASS+1)); } \
  || { echo "FAIL: noisy when core.bare false"; FAIL=$((FAIL+1)); }

# Test 3: non-git command with core.bare=true → ignored (stays true, silent)
git config core.bare true
OUT=$(run_hook "echo git status")
{ [ "$(git config --bool core.bare)" = "true" ] && [ -z "$OUT" ]; } \
  && { echo "PASS: ignores non-git command"; PASS=$((PASS+1)); } \
  || { echo "FAIL: acted on a non-git command"; FAIL=$((FAIL+1)); }
git config core.bare false

# Test 4: compound 'cd foo && git status' heals core.bare
git config core.bare true
OUT=$(run_hook "cd foo && git status")
[ "$(git config --bool core.bare)" = "false" ] \
  && { echo "PASS: heals on a compound git command"; PASS=$((PASS+1)); } \
  || { echo "FAIL: missed compound git command"; FAIL=$((FAIL+1)); }

unset GIT_DIR GIT_WORK_TREE

# Test 5: outside a git repo → silent (fail open)
OUT=$(env -u GIT_DIR -u GIT_WORK_TREE bash -c 'cd /tmp && echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git status\"}}" | bash "$1" 2>/dev/null' _ "$HOOK")
[ -z "$OUT" ] \
  && { echo "PASS: outside a repo fails open (silent)"; PASS=$((PASS+1)); } \
  || { echo "FAIL: not silent outside a repo"; FAIL=$((FAIL+1)); }

# --- Hermeticity guard: caller's real repo untouched ---
CALLER_STATUS_AFTER=$(git status --porcelain 2>/dev/null || true)
[ "$CALLER_STATUS_AFTER" = "$CALLER_STATUS_BEFORE" ] \
  && { echo "PASS: caller repo untouched (hermetic)"; PASS=$((PASS+1)); } \
  || { echo "FAIL: caller repo changed during the test"; FAIL=$((FAIL+1)); }

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
