#!/usr/bin/env bash
# Tests for drift-detect.sh and drift-detect-update.sh — run from project root.
# Hermetic: uses real git in a temp repo; no external tools needed beyond git + jq —
# except the final attribution positive-path case, which needs psql + a live local
# Postgres and SKIPS cleanly (suite still exits 0) when either is missing (CI's
# Lint job has no Postgres service).
set -uo pipefail

HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
DETECT_HOOK="$HOOKS_DIR/drift-detect.sh"
UPDATE_HOOK="$HOOKS_DIR/drift-detect-update.sh"
PASS=0; FAIL=0

# Unique session id for this test run — prevents temp-file collisions with other tests.
TEST_SESSION="test-drift-detect-$$"
BASELINE_FILE="/tmp/claude-drift-detect-${TEST_SESSION}"

cleanup() {
  rm -f "$BASELINE_FILE" "${BASELINE_FILE}.tmp"
  [ -n "${TMPDIR_REPO:-}" ] && rm -rf "$TMPDIR_REPO"
  # Throwaway lab DB from the attribution positive-path case (unset when that case skipped).
  [ -n "${ATTRIB_TEST_DB:-}" ] && psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$ATTRIB_TEST_DB\" WITH (FORCE)" >/dev/null 2>&1
  return 0
}
trap cleanup EXIT

# Run drift-detect.sh with a given command string and the test session id.
run_detect() {
  local cmd="$1"
  local input
  input=$(jq -n \
    --arg c "$cmd" \
    --arg s "$TEST_SESSION" \
    '{"tool_name":"Bash","session_id":$s,"tool_input":{"command":$c}}')
  echo "$input" | bash "$DETECT_HOOK" 2>/dev/null
}

# Run drift-detect-update.sh with a given command string.
run_update() {
  local cmd="$1"
  local input
  input=$(jq -n \
    --arg c "$cmd" \
    --arg s "$TEST_SESSION" \
    '{"tool_name":"Bash","session_id":$s,"tool_input":{"command":$c}}')
  echo "$input" | bash "$UPDATE_HOOK" 2>/dev/null
}

assert_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF "$needle" <<<"$out"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected substring: $needle)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -5)"
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

assert_not_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF "$needle" <<<"$out"; then
    echo "FAIL: $name (unexpected substring: $needle)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
  else
    echo "PASS: $name"; PASS=$((PASS+1))
  fi
}

# --- Set up a temp git repo ---
TMPDIR_REPO=$(mktemp -d)
git -C "$TMPDIR_REPO" init -q
git -C "$TMPDIR_REPO" config user.email "test@test"
git -C "$TMPDIR_REPO" config user.name "Test"
echo "init" > "$TMPDIR_REPO/init.txt"
git -C "$TMPDIR_REPO" add init.txt
git -C "$TMPDIR_REPO" -c commit.gpgsign=false commit -q -m "init"

# Point git ops at the temp repo.
export GIT_DIR="$TMPDIR_REPO/.git"
export GIT_WORK_TREE="$TMPDIR_REPO"

INIT_SHA=$(git rev-parse HEAD)

# --- Test: no session_id → silent ---
OUT=$(jq -n --arg c "git commit -m x" '{"tool_name":"Bash","tool_input":{"command":$c}}' \
  | bash "$DETECT_HOOK" 2>/dev/null)
assert_silent "no session_id: detect is silent" "$OUT"

# Ensure baseline file is absent for the first-op test.
rm -f "$BASELINE_FILE"

# --- Test: no baseline file (first op) → silent, baseline written ---
OUT=$(run_detect "git commit -m x")
assert_silent "first op (no baseline): silent" "$OUT"
RECORDED=$(cat "$BASELINE_FILE" 2>/dev/null || echo "")
if [ "$RECORDED" = "$INIT_SHA" ]; then
  echo "PASS: first op: baseline written with current HEAD"; PASS=$((PASS+1))
else
  echo "FAIL: first op: baseline should be $INIT_SHA, got '$RECORDED'"
  FAIL=$((FAIL+1))
fi

# --- Test: no drift (Claude-recorded SHA matches HEAD) → silent ---
OUT=$(run_detect "git commit -m x")
assert_silent "no drift: detect is silent" "$OUT"

# --- Test: Claude's own commit → update records new SHA, next detect is silent ---
echo "v2" > "$TMPDIR_REPO/v2.txt"
git -C "$TMPDIR_REPO" add v2.txt
git -C "$TMPDIR_REPO" -c commit.gpgsign=false commit -q -m "v2"
V2_SHA=$(git rev-parse HEAD)

# Simulate PostToolUse update after Claude's commit.
run_update "git commit -m v2" >/dev/null
RECORDED=$(cat "$BASELINE_FILE" 2>/dev/null || echo "")
if [ "$RECORDED" = "$V2_SHA" ]; then
  echo "PASS: after Claude commit: baseline updated to $V2_SHA"; PASS=$((PASS+1))
else
  echo "FAIL: after Claude commit: expected $V2_SHA, got '$RECORDED'"
  FAIL=$((FAIL+1))
fi

OUT=$(run_detect "git commit -m next")
assert_silent "after Claude commit: detect is silent" "$OUT"

# --- Test: external drift → detect warns ---
# Simulate user committing externally (HEAD moves without Claude's update hook running).
echo "external" > "$TMPDIR_REPO/external.txt"
git -C "$TMPDIR_REPO" add external.txt
git -C "$TMPDIR_REPO" -c commit.gpgsign=false commit -q -m "external commit by user"
EXT_SHA=$(git rev-parse HEAD)

# Claude's baseline still points to V2_SHA. HEAD is now EXT_SHA → drift.
OUT=$(run_detect "git commit -m claude-next")
assert_contains "external drift: detect warns" "Drift detected" "$OUT"
assert_contains "external drift: includes stored SHA" "$V2_SHA" "$OUT"
assert_contains "external drift: includes current SHA" "$EXT_SHA" "$OUT"
# The warn message must point to worktree isolation as the durable fix (the concurrent-session
# hook that used to carry this nudge was folded away in the 2026-07-03 drift-family consolidation).
assert_contains "external drift: points to the worktree-isolation durable fix" "using-git-worktrees" "$OUT"

# --- Test: git push also triggers detect ---
# Keep the same drifted state (baseline=V2_SHA, HEAD=EXT_SHA).
OUT=$(run_detect "git push -u origin main")
assert_contains "git push: drift warning fires" "Drift detected" "$OUT"

# --- Test: read-only git op (status) does NOT update baseline ---
# Baseline is still V2_SHA (drift state). Run update hook with git status — must not change it.
run_update "git status" >/dev/null
RECORDED=$(cat "$BASELINE_FILE" 2>/dev/null || echo "")
if [ "$RECORDED" = "$V2_SHA" ]; then
  echo "PASS: git status does not update baseline"; PASS=$((PASS+1))
else
  echo "FAIL: git status should not update baseline, got '$RECORDED'"
  FAIL=$((FAIL+1))
fi

# --- Test: Claude's own rebase/reset/pull → update hook records new SHA ---
# Simulate Claude running git rebase (HEAD already at EXT_SHA — just re-record).
run_update "git rebase origin/main" >/dev/null
RECORDED=$(cat "$BASELINE_FILE" 2>/dev/null || echo "")
if [ "$RECORDED" = "$EXT_SHA" ]; then
  echo "PASS: after Claude rebase: baseline updated"; PASS=$((PASS+1))
else
  echo "FAIL: after Claude rebase: expected $EXT_SHA, got '$RECORDED'"
  FAIL=$((FAIL+1))
fi

# Now detect should be silent (baseline matches HEAD).
OUT=$(run_detect "git commit -m after-rebase")
assert_silent "after Claude rebase: detect is silent" "$OUT"

# --- Test: non-git-commit/push command → silent ---
OUT=$(run_detect "git status")
assert_silent "git status: detect is silent" "$OUT"

OUT=$(run_detect "npm run test:run")
assert_silent "npm command: detect is silent" "$OUT"

OUT=$(run_detect "echo 'git commit is great'")
assert_silent "echo with git commit text: detect is silent" "$OUT"

# --- Test: attribution enrichment is fail-silent when the lab DB is unreachable ---
# The rebase-update case above resynced baseline=HEAD, so drift there is gone — re-drift
# with one more external commit (same technique as the earlier drift case) so this run
# actually reaches the MSG line; only LAB_DATABASE_URL changes vs. that earlier case.
echo "external2" > "$TMPDIR_REPO/external2.txt"
git -C "$TMPDIR_REPO" add external2.txt
git -C "$TMPDIR_REPO" -c commit.gpgsign=false commit -q -m "external commit 2"

# drift-detect.sh resolves $COORD as "$(git rev-parse --show-toplevel)/scripts/pg-lab/
# session-coord.sh" — under this fixture's GIT_WORK_TREE override that's $TMPDIR_REPO,
# which has no scripts/pg-lab/ of its own. Symlink the real one in (whole dir, not just
# the script — session-coord.sh sources lib/ps-walk.sh via $SELF_DIR) so the hook truly
# invokes attribute-drift against the unreachable LAB_DATABASE_URL below, rather than
# short-circuiting on a missing $COORD before ever touching the DB.
REAL_PGLAB="$(cd "$HOOKS_DIR/../.." && pwd)/scripts/pg-lab"
mkdir -p "$TMPDIR_REPO/scripts"
ln -s "$REAL_PGLAB" "$TMPDIR_REPO/scripts/pg-lab"

DRIFT_INPUT=$(jq -n --arg c "git commit -m claude-attrib" --arg s "$TEST_SESSION" \
  '{"tool_name":"Bash","session_id":$s,"tool_input":{"command":$c}}')
OUT=$(printf '%s' "$DRIFT_INPUT" | LAB_DATABASE_URL="postgresql://localhost/pg_lab_nope_$$" bash "$DETECT_HOOK" 2>/dev/null)
assert_contains "PG-down drift: classic message still fires" "Drift detected" "$OUT"
assert_not_contains "PG-down drift: no attribution suffix leaked" "Attribution:" "$OUT"

# --- Test: attribution POSITIVE path — another live session registered at this root ---
# Integration coverage for drift-detect.sh's `MSG="$MSG $ATTRIB"` enrichment (the unit
# outcomes live in test-session-coord.sh): seed a throwaway lab DB (same harness as
# test-session-coord.sh) with another live session at THIS fixture repo's resolved root,
# re-trigger the same drifted state as the PG-down case above (baseline still trails HEAD —
# detect never advances it), and assert the attribution suffix rides the drift message.
# DB-gated: CI's Lint job has no Postgres service, so skip cleanly WITHOUT exiting — the
# Results epilogue below must still run so earlier failures propagate.
if command -v psql >/dev/null 2>&1 && psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
  ATTRIB_TEST_DB="pg_lab_drift_attrib_test_$$"
  ATTRIB_TEST_URL="postgresql://localhost/$ATTRIB_TEST_DB"
  LAB_DATABASE_URL="$ATTRIB_TEST_URL" bash "$REAL_PGLAB/init.sh" >/dev/null 2>&1 \
    && psql -X -q -v ON_ERROR_STOP=1 -d "$ATTRIB_TEST_URL" -f "$REAL_PGLAB/schema/session-coordination.sql" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "PASS: attribution DB: throwaway lab DB created and schema applied"; PASS=$((PASS+1))
  else
    echo "FAIL: attribution DB: init.sh/schema apply failed for $ATTRIB_TEST_URL"; FAIL=$((FAIL+1))
  fi

  # Seed another live session at the fixture's RESOLVED root. drift-detect.sh passes
  # $(git rev-parse --show-toplevel) — evaluated under the exported GIT_WORK_TREE, and
  # canonicalized by git (macOS: /tmp → /private/tmp) — and attribute-drift joins on
  # exact repo_root equality, so seed with the same resolved value, not $TMPDIR_REPO.
  # expires_at is omitted: the schema default (now() + 10 min) passes the > now() filter.
  FIXTURE_ROOT=$(git rev-parse --show-toplevel)
  OTHER_SID="drift-other-$$"
  psql -X -q -v ON_ERROR_STOP=1 -d "$ATTRIB_TEST_URL" -v osid="$OTHER_SID" -v root="$FIXTURE_ROOT" >/dev/null <<'SQL'
INSERT INTO harness.session_registry (session_id, repo_root, session_kind, branch)
VALUES (:'osid', :'root', 'goal', 'main');
SQL

  OUT=$(printf '%s' "$DRIFT_INPUT" | LAB_DATABASE_URL="$ATTRIB_TEST_URL" bash "$DETECT_HOOK" 2>/dev/null)
  assert_contains "attributed drift: classic message still fires" "Drift detected" "$OUT"
  assert_contains "attributed drift: attribution suffix appended" "Attribution: session ${OTHER_SID:0:8}" "$OUT"
  assert_contains "attributed drift: names the other session's kind and branch" "(goal, branch main)" "$OUT"
else
  echo "skip: psql or live local Postgres missing — attribution positive-path case not run"
fi

unset GIT_DIR GIT_WORK_TREE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
