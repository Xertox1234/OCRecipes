#!/usr/bin/env bash
# Tests for .husky/pre-push — run from project root (also auto-run by scripts/preflight.sh
# and CI's "Lint · Types · Patterns" job via the .claude/hooks/test-*.sh glob).
#
# Strategy: drive the real hook with the stdin git feeds a pre-push hook
# ("<local-ref> <local-sha> <remote-ref> <remote-sha>" per ref) and assert the DECISION,
# not the heavy preflight. `gh` and `npm` are stubbed on PATH:
#   - npm stub records its args to $NPM_LOG (so we can see fast vs full vs not-run)
#   - gh stub is ARGS-AWARE: `pr list --state open` honors GH_OPEN_PR; `pr view` honors
#     GH_ANY_PR — so a regression from `gh pr list --state open` back to `gh pr view`
#     (which matches closed PRs) is caught by the closed-PR case below.
set -uo pipefail

# --- Hermeticity (see docs/solutions … inherited-git-dir-overrides-git-c) ------
# An absolute GIT_DIR/GIT_WORK_TREE inherited from the caller (VS Code git integration, a
# worktree context) OVERRIDES cwd — `git init` below would then corrupt the REAL repo. Clear
# them so every git command resolves only via the temp repo we create.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

# Snapshot the caller's real repo so we can prove we never touched it.
CALLER_HEAD_BEFORE="$(git rev-parse HEAD 2>/dev/null || true)|$(git symbolic-ref --short HEAD 2>/dev/null || true)"
CALLER_STATUS_BEFORE=$(git status --porcelain 2>/dev/null || true)

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/.husky/pre-push"
ZERO="0000000000000000000000000000000000000000"
PASS=0; FAIL=0

TMP=$(mktemp -d)
cleanup() { cd /; rm -rf "$TMP"; }
trap cleanup EXIT

# --- PATH stubs ---------------------------------------------------------------
BIN="$TMP/bin"; mkdir -p "$BIN"
export NPM_LOG="$TMP/npm.log"

cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$NPM_LOG"
exit 0
EOF

cat > "$BIN/gh" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"pr list"*"--state open"*) [ -n "${GH_OPEN_PR:-}" ] && echo "${GH_OPEN_PR}" ;;
  *"pr view"*)                [ -n "${GH_ANY_PR:-}"  ] && echo "${GH_ANY_PR}"  ;;
esac
exit 0
EOF
chmod +x "$BIN/npm" "$BIN/gh"
export PATH="$BIN:$PATH"

# --- Temp repo with two commits (A = remote sha, B = local sha) ---------------
cd "$TMP"
git init -q
git -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
SHA_A=$(git rev-parse HEAD)
git -c user.email=t@t -c user.name=t commit -q --allow-empty -m B
SHA_B=$(git rev-parse HEAD)

# Run the hook with a given stdin; returns its output, resets NPM_LOG first.
run_case() { : > "$NPM_LOG"; printf '%s' "$1" | bash "$HOOK" 2>&1; }

assert_contains() { # name needle haystack
  if printf '%s' "$3" | grep -qF "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (missing: $2)"; printf '  got: %s\n' "$(printf '%s' "$3" | head -2)"; FAIL=$((FAIL+1)); fi
}
assert_npm_empty() { # name
  if [ ! -s "$NPM_LOG" ]; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (npm ran: $(cat "$NPM_LOG"))"; FAIL=$((FAIL+1)); fi
}
assert_npm_line() { # name exact-line
  if grep -qx "$2" "$NPM_LOG"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (npm log: $(cat "$NPM_LOG"))"; FAIL=$((FAIL+1)); fi
}

# 1. Deletion (all-zero local sha) → skip, npm never runs.
out=$(GH_OPEN_PR=1 GH_ANY_PR=1 run_case "(delete) $ZERO refs/heads/foo $SHA_B"$'\n')
assert_contains  "delete: skips gate" "skipping gate" "$out"
assert_npm_empty "delete: npm not run"

# 2. No-op re-push (empty range B..B) → skip.
out=$(GH_OPEN_PR=1 GH_ANY_PR=1 run_case "refs/heads/main $SHA_B refs/heads/main $SHA_B"$'\n')
assert_contains  "no-op: skips gate" "skipping gate" "$out"
assert_npm_empty "no-op: npm not run"

# 3. New branch (remote sha zero), no PR → fast.
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $ZERO"$'\n')
assert_npm_line "new branch, no PR: runs fast gate" "run preflight:fast"

# 4. Update push with commits + OPEN PR → full.
out=$(GH_OPEN_PR=7 GH_ANY_PR=7 run_case "refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_npm_line "update + open PR: runs full preflight" "run preflight"

# 5. Update push with commits but only a CLOSED PR → fast (the closed-PR fix).
#    GH_ANY_PR set (a closed PR exists, which `gh pr view` would match) but GH_OPEN_PR unset.
out=$(GH_ANY_PR=9 run_case "refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_npm_line "update + closed-only PR: runs fast gate (not full)" "run preflight:fast"

# 6. Empty stdin → legacy fall-through to the normal gate (must NOT skip).
out=$(run_case "")
assert_npm_line "empty stdin: still runs the gate" "run preflight:fast"
if printf '%s' "$out" | grep -qF "skipping gate"; then
  echo "FAIL: empty stdin must not skip"; FAIL=$((FAIL+1));
else echo "PASS: empty stdin does not skip"; PASS=$((PASS+1)); fi

# 7. Mixed delete + update in ONE push → must NOT skip (the no-bypass guarantee:
#    a delete line must never suppress verification of a sibling commit-bearing line).
out=$(run_case "(delete) $ZERO refs/heads/old $SHA_B"$'\n'"refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_npm_line "mixed delete+update: runs the gate" "run preflight:fast"
if printf '%s' "$out" | grep -qF "skipping gate"; then
  echo "FAIL: mixed delete+update must not skip"; FAIL=$((FAIL+1));
else echo "PASS: mixed delete+update does not skip"; PASS=$((PASS+1)); fi

# 8. rev-list fails (remote sha absent locally) → fail safe and verify, never skip.
out=$(run_case "refs/heads/main $SHA_B refs/heads/main 1111111111111111111111111111111111111111"$'\n')
assert_npm_line "unknown remote sha: fail-safe runs the gate" "run preflight:fast"

# --- Hermeticity guard: caller repo untouched ---------------------------------
CALLER_HEAD_AFTER="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)|$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
CALLER_STATUS_AFTER=$(git -C "$ROOT" status --porcelain 2>/dev/null || true)
if [ "$CALLER_HEAD_BEFORE" = "$CALLER_HEAD_AFTER" ] && [ "$CALLER_STATUS_BEFORE" = "$CALLER_STATUS_AFTER" ]; then
  echo "PASS: caller repo untouched (hermetic)"; PASS=$((PASS+1));
else
  echo "FAIL: caller repo changed (non-hermetic leak)"; FAIL=$((FAIL+1)); fi

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
