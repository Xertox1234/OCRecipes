#!/usr/bin/env bash
# Tests for guard-concurrent-session.sh — run from anywhere.
# Hermetic: uses a temp git repo; only git + jq needed.
set -uo pipefail

# --- Hermeticity (todos P2 git-churn) -----------------------------------------
# An inherited absolute GIT_DIR/GIT_WORK_TREE (VS Code terminal / worktree context) OVERRIDES a
# bare `git` and even `git -C`, so without this the temp-repo setup could resolve to the REAL
# repo. Clear them up front; pin git config to /dev/null so we never touch the user's real config.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

# Snapshot the caller's real repo so the end-of-run guard can prove we never touched it.
CALLER_EMAIL_BEFORE=$(git config user.email 2>/dev/null || true)
CALLER_HEAD_BEFORE="$(git rev-parse HEAD 2>/dev/null || true)|$(git symbolic-ref --short HEAD 2>/dev/null || true)"
CALLER_STATUS_BEFORE=$(git status --porcelain 2>/dev/null || true)

HOOK="$(cd "$(dirname "$0")" && pwd)/guard-concurrent-session.sh"
PASS=0; FAIL=0

# Run the hook with cwd inside the temp repo (faithful to how Claude's Bash runs it — no GIT_DIR
# env in production). $1=session_id, $2=command.
run_hook() {
  local sid="$1" cmd="$2" input
  input=$(jq -n --arg s "$sid" --arg c "$cmd" '{"tool_name":"Bash","session_id":$s,"tool_input":{"command":$c}}')
  ( cd "$REPO" && printf '%s' "$input" | bash "$HOOK" 2>/dev/null )
}

assert_warn() {
  local name="$1" out="$2"
  if printf '%s' "$out" | grep -q '"additionalContext"'; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected a warn / additionalContext)"
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

# Temp repo (the shared working tree under test).
REPO=$(mktemp -d)
git -C "$REPO" init -q
git -C "$REPO" config user.email "dev@example.com"
git -C "$REPO" config user.name "Dev"
echo "seed" > "$REPO/seed.txt"
git -C "$REPO" add seed.txt
git -C "$REPO" commit -q -m "init"

# Derive the lease dir exactly as the hook does (toplevel may resolve symlinks, e.g. /tmp→/private/tmp).
TOP=$(cd "$REPO" && git rev-parse --show-toplevel)
KEY=$(printf '%s' "$TOP" | cksum | awk '{print $1}')
LEASE_DIR="/tmp/claude-session-lease/$KEY"
trap 'rm -rf "$REPO" "$LEASE_DIR"' EXIT

reset_leases() { rm -rf "$LEASE_DIR"; }

SESS_A="sess-aaaa-1111"
SESS_B="sess-bbbb-2222"

# Test 1: first mutator op, no peer present → silent (records own lease).
reset_leases
OUT=$(run_hook "$SESS_A" "git commit -m wip --allow-empty")
assert_silent "first mutator with no peer is silent" "$OUT"

# Test 2: peer A made live by a (non-warning) op, then B mutates → warn about A.
reset_leases
OUT=$(run_hook "$SESS_A" "git status")          # non-mutator: refreshes A's lease, no warn
assert_silent "non-mutator op is silent even though it registers a lease" "$OUT"
OUT=$(run_hook "$SESS_B" "git commit -m wip --allow-empty")
assert_warn "mutator with a fresh peer warns" "$OUT"
if printf '%s' "$OUT" | grep -qi "worktree"; then
  echo "PASS: warn message nudges toward a worktree"; PASS=$((PASS+1))
else
  echo "FAIL: warn message should mention a worktree"; FAIL=$((FAIL+1))
fi

# Test 3: dedup — B mutates again → silent (already warned once this session).
OUT=$(run_hook "$SESS_B" "git push origin main")
assert_silent "second mutator from the same session is silent (warn-once)" "$OUT"

# Test 4: stale peer (lease older than TTL) → no live peer → silent.
reset_leases
mkdir -p "$LEASE_DIR"
touch -t 200001010000 "$LEASE_DIR/$SESS_A"      # year 2000 — far outside the 20-min TTL
OUT=$(run_hook "$SESS_B" "git commit -m wip --allow-empty")
assert_silent "a stale peer lease does not trigger a warning" "$OUT"

# Test 5: fresh peer but a NON-mutator op → silent (warning is gated on mutators).
reset_leases
mkdir -p "$LEASE_DIR"
touch "$LEASE_DIR/$SESS_A"                       # fresh peer
OUT=$(run_hook "$SESS_B" "git log --oneline")
assert_silent "non-mutator op with a fresh peer stays silent" "$OUT"

# Test 6: compound mutator (git add && git commit) with a fresh peer → warn.
reset_leases
mkdir -p "$LEASE_DIR"
touch "$LEASE_DIR/$SESS_A"
OUT=$(run_hook "$SESS_B" "git add -A && git commit -m wip")
assert_warn "compound 'git add && git commit' with a fresh peer warns" "$OUT"

# Test 7: `git stash` (working-tree mutator most likely to destroy in-flight work) with a fresh
# peer → warn. Guards the P2 "clobbered uncommitted edits" motivation specifically.
reset_leases
mkdir -p "$LEASE_DIR"
touch "$LEASE_DIR/$SESS_A"
OUT=$(run_hook "$SESS_B" "git stash")
assert_warn "git stash with a fresh peer warns" "$OUT"

# Test 8: missing session_id → silent (cannot key a lease).
reset_leases
INPUT=$(jq -n --arg c "git commit -m wip" '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$( ( cd "$REPO" && printf '%s' "$INPUT" | bash "$HOOK" 2>/dev/null ) )
assert_silent "missing session_id fails open (silent)" "$OUT"

# Test 9: outside a git repo → silent (fail-open).
OUT=$( ( cd /tmp && printf '%s' "$(jq -n '{"tool_name":"Bash","session_id":"s","tool_input":{"command":"git commit -m x"}}')" | bash "$HOOK" 2>/dev/null ) )
assert_silent "outside a git repo fails open (silent)" "$OUT"

# Test 10: malformed JSON → silent (fail-open).
OUT=$(printf '%s' 'not json at all' | bash "$HOOK" 2>/dev/null)
assert_silent "malformed JSON fails open (silent)" "$OUT"

# --- Hermeticity guard: prove the caller's real repo is byte-for-byte untouched. ---
CALLER_EMAIL_AFTER=$(git config user.email 2>/dev/null || true)
CALLER_HEAD_AFTER="$(git rev-parse HEAD 2>/dev/null || true)|$(git symbolic-ref --short HEAD 2>/dev/null || true)"
CALLER_STATUS_AFTER=$(git status --porcelain 2>/dev/null || true)
if [ "$CALLER_EMAIL_AFTER" = "$CALLER_EMAIL_BEFORE" ] \
  && [ "$CALLER_HEAD_AFTER" = "$CALLER_HEAD_BEFORE" ] \
  && [ "$CALLER_STATUS_AFTER" = "$CALLER_STATUS_BEFORE" ]; then
  echo "PASS: caller repo untouched (hermetic — no inherited-GIT_DIR leak)"; PASS=$((PASS+1))
else
  echo "FAIL: HERMETICITY — this test mutated the caller's real repo (inherited GIT_DIR leak)"
  [ "$CALLER_EMAIL_AFTER" != "$CALLER_EMAIL_BEFORE" ] && printf '  user.email: [%s] -> [%s]\n' "$CALLER_EMAIL_BEFORE" "$CALLER_EMAIL_AFTER"
  [ "$CALLER_HEAD_AFTER" != "$CALLER_HEAD_BEFORE" ] && printf '  HEAD: [%s] -> [%s]\n' "$CALLER_HEAD_BEFORE" "$CALLER_HEAD_AFTER"
  [ "$CALLER_STATUS_AFTER" != "$CALLER_STATUS_BEFORE" ] && printf '  working tree changed (porcelain differs)\n'
  FAIL=$((FAIL+1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
