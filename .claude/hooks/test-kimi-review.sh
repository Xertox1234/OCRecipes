#!/usr/bin/env bash
# Tests for kimi-review.sh — run from project root.
# Tests are hermetic: a stub `kimi-review` (and optionally `git`) is shimmed onto PATH
# via a temp dir, so no real review is ever invoked and no API key is needed.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/kimi-review.sh"
PASS=0; FAIL=0

# Make a sandbox PATH with stub binaries. The stub mirrors kimi-review's real
# output: findings are `[TIER] path:line — description` lines, a clean run prints
# `No findings in requested tiers: CRITICAL, WARNING`. KIMI_STUB_MODE controls it:
#   critical          → a plain [CRITICAL] finding line
#   critical-bracket  → a bullet+indent decorated [CRITICAL] finding line
#   critical-bold     → a markdown-bold-wrapped [CRITICAL] finding line
#   critical-nobody   → a bare [CRITICAL] tag with no finding body
#   warning           → a [WARNING] finding line
#   noisy-prose       → lowercase "critical" in prose, no real finding
#   negative-prose    → the model's "No CRITICAL or WARNING findings" phrasing
#   clean             → kimi-review's clean-output message (prose phrasing)
#   clean-tiered      → kimi-review's clean output as bracketed per-tier headers
#   critical-no-findings-desc → a real [CRITICAL] finding whose description says "no findings"
make_stub_path() {
  local mode="$1"
  local dir
  dir=$(mktemp -d)
  cat > "$dir/kimi-review" <<EOF
#!/usr/bin/env bash
cat >/dev/null  # consume stdin so the pipe doesn't SIGPIPE
case "$mode" in
  critical)         echo "[CRITICAL] server/routes/foo.ts:42 — stub finding for tests";;
  critical-bracket) echo "  - [CRITICAL] server/routes/foo.ts:10 — bullet+indent decorated finding";;
  critical-bold)    echo "**[CRITICAL]** server/routes/foo.ts:10 — markdown-bold form";;
  critical-nobody)  echo "[CRITICAL]";;
  warning)          echo "[WARNING] server/routes/foo.ts:5 — stub finding for tests";;
  noisy-prose)      echo "no critical issues found in stub run";;
  negative-prose)   echo "No CRITICAL or WARNING findings";;
  clean)            echo "No findings in requested tiers: CRITICAL, WARNING";;
  clean-tiered)     printf '[CRITICAL] — No findings.\n[WARNING] — No findings.\n';;
  critical-no-findings-desc)
                    echo "[CRITICAL] server/routes/foo.ts:42 — error handler swallows the error and returns no findings to the caller";;
esac
EOF
  chmod +x "$dir/kimi-review"
  # Stub git to return a fake staged file list + a fake diff so the hook
  # proceeds past the "no staged files" guard without touching the real index.
  cat > "$dir/git" <<'EOF'
#!/usr/bin/env bash
case "$* " in
  "diff --cached --name-only "*) echo "server/routes/foo.ts";;
  "diff --cached "*)              echo "diff --git a/x b/x";;
  *) exec /usr/bin/env -i PATH="/usr/bin:/bin" git "$@";;
esac
EOF
  chmod +x "$dir/git"
  printf '%s' "$dir"
}

# Run the hook with a stub PATH. $1 = kimi mode, $2 = stdin JSON.
run_hook() {
  local mode="$1" input="$2"
  local stubdir
  stubdir=$(make_stub_path "$mode")
  echo "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null
  local rc=$?
  rm -rf "$stubdir"
  return $rc
}

# Capture both stdout and exit code from a single run.
run_capture() {
  local mode="$1" input="$2"
  local stubdir output rc
  stubdir=$(make_stub_path "$mode")
  output=$(echo "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null)
  rc=$?
  rm -rf "$stubdir"
  printf '%s\n--RC--%d' "$output" "$rc"
}

assert_contains() {
  local name="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected to find: $needle)"
    echo "  got: $(echo "$haystack" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

assert_not_contains() {
  local name="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle"; then
    echo "FAIL: $name (expected NOT to find: $needle)"
    echo "  got: $(echo "$haystack" | head -3)"
    FAIL=$((FAIL+1))
  else
    echo "PASS: $name"; PASS=$((PASS+1))
  fi
}

assert_empty() {
  local name="$1" haystack="$2"
  if [ -z "$haystack" ]; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected empty output)"
    echo "  got: $(echo "$haystack" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

# ---------- Command matcher tests ----------

# Plain `git commit` → match, hook runs (clean review → additionalContext JSON)
OUT=$(run_hook clean '{"tool_input":{"command":"git commit -m \"x\""}}')
assert_contains "git commit matches and emits review JSON" "$OUT" "additionalContext"

# `git -c user.name=x commit` → match
OUT=$(run_hook clean '{"tool_input":{"command":"git -c user.name=x commit -m y"}}')
assert_contains "git -c ... commit matches" "$OUT" "additionalContext"

# Leading env var assignment → match
OUT=$(run_hook clean '{"tool_input":{"command":"GIT_AUTHOR_NAME=foo git commit -m y"}}')
assert_contains "FOO=bar git commit matches" "$OUT" "additionalContext"

# `git commit-graph write` → NO match (silent exit 0)
OUT=$(run_hook clean '{"tool_input":{"command":"git commit-graph write"}}')
assert_empty "git commit-graph does NOT match" "$OUT"

# `echo git commit ...` → NO match
OUT=$(run_hook clean '{"tool_input":{"command":"echo git commit -m x"}}')
assert_empty "echo git commit does NOT match" "$OUT"

# Arbitrary text containing the substring → NO match
OUT=$(run_hook clean '{"tool_input":{"command":"foo git commit bar"}}')
assert_empty "substring git commit does NOT match" "$OUT"

# Unrelated git command → NO match
OUT=$(run_hook clean '{"tool_input":{"command":"git push origin main"}}')
assert_empty "git push does NOT match" "$OUT"

# ---------- Skip semantics ----------

# SKIP_KIMI_REVIEW=1 must skip even when the command matches
OUT=$(SKIP_KIMI_REVIEW=1 echo '{"tool_input":{"command":"git commit -m x"}}' | bash "$HOOK" 2>/dev/null)
assert_empty "SKIP_KIMI_REVIEW=1 skips" "$OUT"

# Missing kimi-review on PATH must skip. Use a sandbox PATH with no kimi-review
# binary; keep jq + git available via /usr/bin and /bin.
EMPTY_DIR=$(mktemp -d)
OUT=$(echo '{"tool_input":{"command":"git commit -m x"}}' | \
  PATH="$EMPTY_DIR:/usr/bin:/bin" bash "$HOOK" 2>/dev/null)
rm -rf "$EMPTY_DIR"
assert_empty "missing kimi-review skips" "$OUT"

# ---------- Tier handling ----------

# WARNING-only review must NOT block — emits additionalContext JSON, no deny
OUT=$(run_hook warning '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "WARNING emits additionalContext (non-blocking)" "$OUT" "additionalContext"
assert_not_contains "WARNING does not emit permissionDecision deny" "$OUT" '"permissionDecision": "deny"'

# CRITICAL review must block via permissionDecision deny
OUT=$(run_hook critical '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "CRITICAL emits permissionDecision deny" "$OUT" '"permissionDecision": "deny"'
assert_contains "CRITICAL emits permissionDecisionReason" "$OUT" "permissionDecisionReason"

# Decorated [CRITICAL] finding lines must still block — the matcher is not
# anchored to line start, so leading bullets/indent and bold-wrapping fail closed.
OUT=$(run_hook critical-bracket '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "bullet+indent decorated [CRITICAL] blocks" "$OUT" '"permissionDecision": "deny"'

OUT=$(run_hook critical-bold '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "**[CRITICAL]** markdown-bold form blocks" "$OUT" '"permissionDecision": "deny"'

# A bare [CRITICAL] tag with no finding body must NOT block — require a body.
OUT=$(run_hook critical-nobody '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "bare [CRITICAL] with no body does NOT block" "$OUT" '"permissionDecision": "deny"'

# Lowercase "critical" in prose must NOT trip the matcher.
OUT=$(run_hook noisy-prose '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "lowercase 'critical' in prose does NOT block" "$OUT" '"permissionDecision": "deny"'
assert_contains "noisy-prose still emits additionalContext" "$OUT" "additionalContext"

# Regression: the word CRITICAL in kimi-review's own clean-output message and in
# the model's negative phrasing must NOT block — this is the phantom-CRITICAL bug.
OUT=$(run_hook clean '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "clean-output message ('...tiers: CRITICAL, WARNING') does NOT block" "$OUT" '"permissionDecision": "deny"'

OUT=$(run_hook negative-prose '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "negative phrasing ('No CRITICAL or WARNING findings') does NOT block" "$OUT" '"permissionDecision": "deny"'

# Regression: kimi-review's real clean output prints a bracketed per-tier
# section header for every requested tier (`[CRITICAL] — No findings.`). That
# header carries the bracketed `[CRITICAL]` tag with a body, so the tag alone
# cannot be the block signal — the "No findings" sentinel must NOT block.
OUT=$(run_hook clean-tiered '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "bracketed '[CRITICAL] — No findings.' header does NOT block" "$OUT" '"permissionDecision": "deny"'
assert_contains "clean-tiered emits additionalContext" "$OUT" "additionalContext"

# Regression: a real [CRITICAL] finding whose description happens to contain the
# phrase "no findings" MUST still block. The sentinel filter has to key on the
# sentinel's shape ([CRITICAL] followed only by non-alphanumeric separators),
# not a bare "no findings" substring — otherwise it fails open on such findings.
OUT=$(run_hook critical-no-findings-desc '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "[CRITICAL] finding with 'no findings' in its description still blocks" "$OUT" '"permissionDecision": "deny"'

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
