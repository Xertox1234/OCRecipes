#!/usr/bin/env bash
# Tests for .husky/pre-push (post-2026-07 gate consolidation). The hook now ALWAYS runs the
# fast smoke gate, except: (a) delete/no-op pushes, and (b) HEAD already carries a pass-stamp.
# There is NO gh-based full escalation anymore. Drives the real hook with the stdin git feeds a
# pre-push hook ("<local-ref> <local-sha> <remote-ref> <remote-sha>" per ref) and asserts the
# DECISION (which npm command, or none) + the skip ORDERING. `npm` is stubbed on PATH.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

# Snapshot the caller's real repo to prove we never touch it.
CALLER_HEAD_BEFORE="$(git rev-parse HEAD 2>/dev/null || true)|$(git symbolic-ref --short HEAD 2>/dev/null || true)"
CALLER_STATUS_BEFORE=$(git status --porcelain 2>/dev/null || true)

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/.husky/pre-push"
ZERO="0000000000000000000000000000000000000000"
PASS=0; FAIL=0

TMP=$(mktemp -d)
cleanup() { cd /; rm -rf "$TMP"; }
trap cleanup EXIT

BIN="$TMP/bin"; mkdir -p "$BIN"
export NPM_LOG="$TMP/npm.log"
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$NPM_LOG"
exit 0
EOF
chmod +x "$BIN/npm"
export PATH="$BIN:$PATH"

# The hook sources scripts/lib/preflight-stamp-path.sh from the repo root it runs in — copy the
# REAL helper into the temp repo so stamp resolution works. The helper honors PREFLIGHT_STAMP_FILE.
mkdir -p "$TMP/scripts/lib"
cp "$ROOT/scripts/lib/preflight-stamp-path.sh" "$TMP/scripts/lib/"
export PREFLIGHT_STAMP_FILE="$TMP/stamp"

cd "$TMP"
git init -q
git -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
SHA_A=$(git rev-parse HEAD)
git -c user.email=t@t -c user.name=t commit -q --allow-empty -m B
SHA_B=$(git rev-parse HEAD)   # == HEAD

run_case() { : > "$NPM_LOG"; printf '%s' "$1" | bash "$HOOK" 2>&1; }
assert_contains() { if printf '%s' "$3" | grep -qF "$2"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (missing: $2)"; printf '  got: %s\n' "$(printf '%s' "$3" | head -2)"; FAIL=$((FAIL+1)); fi; }
assert_absent()   { if printf '%s' "$3" | grep -qF "$2"; then echo "FAIL: $1 (present: $2)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }
assert_npm_empty(){ if [ ! -s "$NPM_LOG" ]; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (npm ran: $(cat "$NPM_LOG"))"; FAIL=$((FAIL+1)); fi; }
assert_npm_line() { if grep -qx "$2" "$NPM_LOG"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (npm log: $(cat "$NPM_LOG"))"; FAIL=$((FAIL+1)); fi; }

rm -f "$PREFLIGHT_STAMP_FILE"

# 1. Deletion (all-zero local sha) → skip, npm never runs.
out=$(run_case "(delete) $ZERO refs/heads/foo $SHA_B"$'\n')
assert_contains  "delete: skips gate" "skipping gate" "$out"
assert_npm_empty "delete: npm not run"

# 2. No-op re-push (empty range B..B) → skip.
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $SHA_B"$'\n')
assert_contains  "no-op: skips gate" "skipping gate" "$out"
assert_npm_empty "no-op: npm not run"

# 3. New branch (remote sha zero), no stamp → fast.
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $ZERO"$'\n')
assert_npm_line "new branch, no stamp: runs fast gate" "run preflight:fast"

# 4. Update push with commits, no stamp → fast (NO full escalation exists anymore).
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_npm_line "update, no stamp: runs fast gate" "run preflight:fast"

# 5. HEAD already stamped → skip (npm not run).
echo "$SHA_B" > "$PREFLIGHT_STAMP_FILE"
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_contains  "stamped HEAD: skips gate" "already verified" "$out"
assert_npm_empty "stamped HEAD: npm not run"

# 6. Stale stamp (different sha) → fast (must re-verify a changed HEAD).
echo "$SHA_A" > "$PREFLIGHT_STAMP_FILE"
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_npm_line "stale stamp: runs fast gate" "run preflight:fast"

# 7. ORDERING: a delete push while HEAD is stamped must take the DELETE path, not the stamp
#    path — the delete/no-op skip runs first and never consults the stamp.
echo "$SHA_B" > "$PREFLIGHT_STAMP_FILE"
out=$(run_case "(delete) $ZERO refs/heads/foo $SHA_B"$'\n')
assert_contains "delete-before-stamp: uses the delete message" "branch deletion" "$out"
assert_absent   "delete-before-stamp: did not consult stamp"   "already verified" "$out"
rm -f "$PREFLIGHT_STAMP_FILE"

# 8. Mixed delete + update in ONE push → must NOT skip (a delete line must not suppress a
#    sibling commit-bearing line).
out=$(run_case "(delete) $ZERO refs/heads/old $SHA_B"$'\n'"refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_npm_line "mixed delete+update: runs the gate" "run preflight:fast"

# 9. rev-list fails (remote sha absent locally) → fail safe and verify, never skip.
out=$(run_case "refs/heads/main $SHA_B refs/heads/main 1111111111111111111111111111111111111111"$'\n')
assert_npm_line "unknown remote sha: fail-safe runs the gate" "run preflight:fast"

# --- Hermeticity guard: caller repo untouched ---------------------------------
CALLER_HEAD_AFTER="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)|$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
CALLER_STATUS_AFTER=$(git -C "$ROOT" status --porcelain 2>/dev/null || true)
if [ "$CALLER_HEAD_BEFORE" = "$CALLER_HEAD_AFTER" ] && [ "$CALLER_STATUS_BEFORE" = "$CALLER_STATUS_AFTER" ]; then
  echo "PASS: caller repo untouched (hermetic)"; PASS=$((PASS+1));
else echo "FAIL: caller repo changed (non-hermetic leak)"; FAIL=$((FAIL+1)); fi

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
