#!/usr/bin/env bash
# Tests for commit-verify.sh — run from project root.
# Hermetic: uses real git in a temp repo; no external tools needed.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/commit-verify.sh"
PASS=0; FAIL=0

# Run the hook with a given command string. Uses real git in TMPDIR.
run_hook() {
  local cmd="$1"
  local input
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  echo "$input" | bash "$HOOK" 2>/dev/null
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

# --- Set up a temp git repo ---
TMPDIR_REPO=$(mktemp -d)
trap 'rm -rf "$TMPDIR_REPO"' EXIT
git -C "$TMPDIR_REPO" init -q
git -C "$TMPDIR_REPO" config user.email "test@test"
git -C "$TMPDIR_REPO" config user.name "Test"
# Initial commit so the repo has a HEAD
echo "init" > "$TMPDIR_REPO/init.txt"
git -C "$TMPDIR_REPO" add init.txt
git -C "$TMPDIR_REPO" commit -q -m "init"

# Stage a file (simulates a blocked commit — staged files remain)
echo "content" > "$TMPDIR_REPO/staged.ts"
git -C "$TMPDIR_REPO" add staged.ts

# Override git to run against TMPDIR_REPO
export GIT_DIR="$TMPDIR_REPO/.git"
export GIT_WORK_TREE="$TMPDIR_REPO"

# Test 1: staged files remain after git commit → warn about silent block
OUT=$(run_hook "git commit -m 'test'")
assert_contains "blocked commit: warns silently blocked" "silently blocked" "$OUT"
assert_contains "blocked commit: lists staged file" "staged.ts" "$OUT"

# Clear staged files (simulate a clean commit)
git -C "$TMPDIR_REPO" commit -q -m "add staged" 2>/dev/null || true

# Test 2: no staged files → silent (clean success must not add per-commit noise)
OUT=$(run_hook "git commit -m 'test'")
assert_silent "clean commit is silent" "$OUT"

# Test 3: non-commit command → silence
OUT=$(run_hook "git status")
assert_silent "non-commit command is silent" "$OUT"

# Test 4: substring that shouldn't match (echo containing git commit text)
OUT=$(run_hook "echo 'git commit is great'")
assert_silent "substring false match is silent" "$OUT"

# Test 5: compound command — the most common agent form — must still be verified
# (2026-07-18 harness-audit M7: start-anchored regex missed `git add && git commit`).
echo "more" > "$TMPDIR_REPO/staged2.ts"
git -C "$TMPDIR_REPO" add staged2.ts
OUT=$(run_hook "git add -A && git commit -m 'x'")
assert_contains "compound commit: warns silently blocked" "silently blocked" "$OUT"
git -C "$TMPDIR_REPO" commit -q -m "clean2" 2>/dev/null || true

# Test 6: separator+commit text inside quotes stays silent even with files staged
# (quote-strip parity with pr-preflight-guard — guards the compound fix against noise).
echo "more2" > "$TMPDIR_REPO/staged3.ts"
git -C "$TMPDIR_REPO" add staged3.ts
OUT=$(run_hook 'echo "x; git commit inside quotes"')
assert_silent "quoted separator substring is silent" "$OUT"
git -C "$TMPDIR_REPO" commit -q -m "clean3" 2>/dev/null || true

# Test 7: escaped-quote glue must not hide a real commit (Phase 6 review, 2026-07-18 audit) —
# a naive quote-strip pairs \" with the next opening quote, deleting `&& git commit` entirely.
echo "more3" > "$TMPDIR_REPO/staged4.ts"
git -C "$TMPDIR_REPO" add staged4.ts
OUT=$(run_hook 'echo "escaped \" quote" && git commit -m "second"')
assert_contains "escaped-quote glue: still verified" "silently blocked" "$OUT"
git -C "$TMPDIR_REPO" commit -q -m "clean4" 2>/dev/null || true

unset GIT_DIR GIT_WORK_TREE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
