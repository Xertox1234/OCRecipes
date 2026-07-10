#!/usr/bin/env bash
# Tests scripts/preflight.sh quiet-on-success output contract:
#   - default: command output SUPPRESSED on pass (only a ✔ line); DUMPED on fail (✗ + output).
#   - PREFLIGHT_VERBOSE=1: output STREAMED even on pass.
# Drives the real script's --fast mode with a stubbed `npm`, in a temp repo with a single
# commit (so no changed .ts files → only the npm-backed steps run). Fully hermetic.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/preflight.sh"
PASS=0; FAIL=0
assert_has() { if grep -qF -- "$2" <<<"$3"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (missing: $2)"; FAIL=$((FAIL+1)); fi; }
assert_not() { if grep -qF -- "$2" <<<"$3"; then echo "FAIL: $1 (should be absent: $2)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
BIN="$TMP/bin"; mkdir -p "$BIN"
export PREFLIGHT_STAMP_FILE="$TMP/stamp"

make_repo() { local d; d=$(mktemp -d); git -C "$d" init -q; git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m only; printf '%s' "$d"; }

# --- success: npm exits 0 and prints NOISE that must be suppressed ---------------
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "NPM_NOISE_LINE"
exit 0
EOF
chmod +x "$BIN/npm"
REPO=$(make_repo)
OUT=$( cd "$REPO" && PATH="$BIN:$PATH" bash "$SCRIPT" --fast 2>&1 ); rm -rf "$REPO"
assert_not "quiet: npm noise suppressed on success" "NPM_NOISE_LINE" "$OUT"
assert_has "quiet: shows a check summary line"      "✔" "$OUT"
assert_has "quiet: reaches the fast-pass banner"    "preflight:fast passed" "$OUT"

# --- verbose: same stub, PREFLIGHT_VERBOSE=1 → noise STREAMED --------------------
REPO=$(make_repo)
OUT=$( cd "$REPO" && PATH="$BIN:$PATH" PREFLIGHT_VERBOSE=1 bash "$SCRIPT" --fast 2>&1 ); rm -rf "$REPO"
assert_has "verbose: npm noise streamed on success" "NPM_NOISE_LINE" "$OUT"

# --- failure: npm exits 1 with detail that MUST be dumped, non-zero exit ---------
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "NPM_FAILURE_DETAIL"
exit 1
EOF
chmod +x "$BIN/npm"
REPO=$(make_repo)
OUT=$( cd "$REPO" && PATH="$BIN:$PATH" bash "$SCRIPT" --fast 2>&1 ); RC=$?; rm -rf "$REPO"
assert_has "fail: dumps the failing command output" "NPM_FAILURE_DETAIL" "$OUT"
assert_has "fail: shows a failure marker"           "✗" "$OUT"
if [ "$RC" -ne 0 ]; then echo "PASS: fail: non-zero exit"; PASS=$((PASS+1)); else echo "FAIL: fail: expected non-zero exit"; FAIL=$((FAIL+1)); fi

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
