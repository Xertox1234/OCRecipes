#!/usr/bin/env bash
# Tests for branch-preflight.sh — run from project root.
# Hermetic: uses a temp git repo; no external tools needed beyond git + jq.
set -uo pipefail

# --- Hermeticity (todos P2 git-churn) -----------------------------------------
# Git env vars inherited from the caller — an absolute GIT_DIR/GIT_WORK_TREE injected by
# VS Code's git integration or a worktree context — OVERRIDE `git -C <dir>`. Left set, the
# temp-repo setup below would silently run against the REAL repo: writing t@t/T into its
# config, staging a phantom x.txt, and detaching/switching its HEAD (reverting live edits).
# Clear them up front so every `git` here resolves only via the temp repo we create.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null  # never read/write the user's real git config

# Snapshot the caller's real repo so the end-of-run guard can prove we never touched it.
CALLER_EMAIL_BEFORE=$(git config user.email 2>/dev/null || true)
CALLER_HEAD_BEFORE="$(git rev-parse HEAD 2>/dev/null || true)|$(git symbolic-ref --short HEAD 2>/dev/null || true)"
CALLER_STATUS_BEFORE=$(git status --porcelain 2>/dev/null || true)

HOOK="$(cd "$(dirname "$0")" && pwd)/branch-preflight.sh"
PASS=0; FAIL=0

run_hook() {
  local cmd="$1"
  local input
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  echo "$input" | bash "$HOOK" 2>/dev/null
}

assert_deny() {
  local name="$1" out="$2"
  if grep -q '"permissionDecision": "deny"' <<<"$out"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected deny)"
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

# Set up a temp git repo
REPO=$(mktemp -d)
BAREORIGIN=""  # pre-initialized so the EXIT trap is set -u safe before it's created
trap 'rm -rf "$REPO" "${BAREORIGIN:-}"' EXIT
git -C "$REPO" init -q
git -C "$REPO" config user.email "t@t"
git -C "$REPO" config user.name "T"
echo "x" > "$REPO/x.txt"
git -C "$REPO" add x.txt
git -C "$REPO" commit -q -m "init"
INITIAL_BRANCH=$(git -C "$REPO" symbolic-ref --short HEAD 2>/dev/null || echo "main")

export GIT_DIR="$REPO/.git"
export GIT_WORK_TREE="$REPO"

# Test 1: on main → silent (enforce_admins off; owner pushes to main directly)
OUT=$(run_hook "git commit -m 'ok'")
assert_silent "commit on main is allowed" "$OUT"

# Test 3: detached HEAD → deny, message mentions the detached state
git -C "$REPO" checkout --detach HEAD -q 2>/dev/null
OUT=$(run_hook "git commit -m 'oops'")
assert_deny "commit on detached HEAD is denied" "$OUT"
if grep -qi "detached" <<<"$OUT"; then
  echo "PASS: deny message mentions detached HEAD"; PASS=$((PASS+1))
else
  echo "FAIL: deny message should mention detached HEAD"
  FAIL=$((FAIL+1))
fi

# Test 4: feature branch → silent
git -C "$REPO" switch -c fix/my-feature -q 2>/dev/null
OUT=$(run_hook "git commit -m 'ok'")
assert_silent "commit on feature branch is silent" "$OUT"

# Test 5: non-commit command on main → silent
git -C "$REPO" switch "$INITIAL_BRANCH" -q 2>/dev/null
OUT=$(run_hook "git status")
assert_silent "non-commit command is silent even on main" "$OUT"

# Test 6: SKIP_BRANCH_PREFLIGHT=1 on main → silent
OUT=$(SKIP_BRANCH_PREFLIGHT=1 run_hook "git commit -m 'skip'")
assert_silent "SKIP_BRANCH_PREFLIGHT=1 bypasses deny on main" "$OUT"

# Test 7: outside a git repo → silent (fail-open)
OUT=$(env -u GIT_DIR -u GIT_WORK_TREE bash -c 'cd /tmp && echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m test\"}}" | bash "$1" 2>/dev/null' _ "$HOOK")
assert_silent "outside a git repo fails open (silent)" "$OUT"

# Test 8: compound form (git add && git commit) on detached HEAD → deny
export GIT_DIR="$REPO/.git"
export GIT_WORK_TREE="$REPO"
git -C "$REPO" checkout --detach HEAD -q 2>/dev/null
OUT=$(run_hook "git add -A && git commit -m 'oops'")
assert_deny "compound 'git add && git commit' on detached HEAD is denied" "$OUT"

# Test 8b: forms the OLD compound regex MISSED but the shared command-position prefix now catches
# — subshell `(` and pipe `|` — must also deny on detached HEAD. Guards the deliberate broadening
# of the match set (separator class (^|[;&|(]) is wider than the old (&&|\|\||;)) against a future
# prefix-narrowing that would silently reopen the unreachable-commit data-loss.
OUT=$(run_hook '(git commit -m oops)')
assert_deny "subshell '(git commit)' on detached HEAD is denied" "$OUT"
OUT=$(run_hook 'true | git commit -m oops')
assert_deny "piped 'true | git commit' on detached HEAD is denied" "$OUT"

# Test 9: a quoted MENTION of "; git commit" inside a -m message must NOT be read as a real
# commit — silent even on detached HEAD (quote-aware port; the raw COMPOUND_COMMIT_RE matched
# the ';' inside the quotes and false-DENYd). Still detached from Test 8.
OUT=$(run_hook 'git status -m "wip; git commit now"')
assert_silent "quoted 'git commit' mention is not a real commit (detached HEAD)" "$OUT"

# Test 10: lib/cmd-detect.sh unsourceable → BLOCKING gate fails CLOSED. Copy just the hook into
# a dir with no lib/ sibling so the source fails, then a real detached-HEAD commit must STILL
# deny (raw-regex fallback). Guards the fail-safe direction against a future fail-OPEN refactor.
NOLIB=$(mktemp -d)
cp "$HOOK" "$NOLIB/branch-preflight.sh"
NOLIB_INPUT=$(jq -n --arg c "git commit -m 'oops'" '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: real detached-HEAD commit still denied (fail-closed)" "$OUT"
rm -rf "$NOLIB"

# --- Stale-base branch-create check: fetch-then-deny (2026-08-28) --------------
# A bare "origin" gives the check something real to fetch, entirely off-network.
# GIT_DIR/GIT_WORK_TREE are exported (for $REPO) at this point and OVERRIDE `-C` for
# any OTHER repo touched in this same shell (the exact hazard this file's own header
# comment warns about) — every git call below that isn't `git -C "$REPO"` must strip
# them via `env -u`, including inside advance_remote's clone.
BAREORIGIN=$(mktemp -d)
env -u GIT_DIR -u GIT_WORK_TREE git init --bare -q "$BAREORIGIN"
git -C "$REPO" switch "$INITIAL_BRANCH" -q 2>/dev/null
git -C "$REPO" remote add origin "$BAREORIGIN"
git -C "$REPO" push -u -q origin "$INITIAL_BRANCH" 2>/dev/null

# advance_remote <file> <msg> — commits+pushes from a throwaway clone, so the bare
# origin moves AHEAD of $REPO without $REPO's local branch or working tree changing
# (mirrors "someone else's PR merged upstream while you were working").
advance_remote() {
  local clone; clone=$(mktemp -d)
  env -u GIT_DIR -u GIT_WORK_TREE git clone -q "$BAREORIGIN" "$clone"
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$clone" config user.email "t@t"
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$clone" config user.name "T"
  echo "x" > "$clone/$1"
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$clone" add "$1"
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$clone" commit -q -m "$2"
  env -u GIT_DIR -u GIT_WORK_TREE git -C "$clone" push -q origin "$INITIAL_BRANCH"
  rm -rf "$clone"
}

# Test 11: no drift → branch-create is silent.
OUT=$(run_hook "git checkout -b feature/one")
assert_silent "branch-create with fresh base is silent" "$OUT"

# Test 12: remote advances without $REPO knowing → branch-create DENIES (hook fetches
# internally and finds local behind).
advance_remote "a.txt" "landed elsewhere"
OUT=$(run_hook "git checkout -b feature/two")
assert_deny "branch-create denied when base is behind its fetched upstream" "$OUT"
if grep -qi "behind" <<<"$OUT"; then
  echo "PASS: deny message explains the branch is behind"; PASS=$((PASS+1))
else
  echo "FAIL: deny message should mention being behind"; FAIL=$((FAIL+1))
fi

# Test 13: the internal fetch does not self-heal — still denies until an actual merge.
OUT=$(run_hook "git switch -c feature/three")
assert_deny "still denies on a second attempt (fetch alone never fast-forwards local)" "$OUT"

# Test 14: SKIP_BRANCH_PREFLIGHT bypasses the stale-base deny too, not just detached-HEAD.
OUT=$(SKIP_BRANCH_PREFLIGHT=1 run_hook "git checkout -b feature/four")
assert_silent "SKIP_BRANCH_PREFLIGHT bypasses the stale-base deny" "$OUT"

# Test 15: fast-forwarding local resolves it — silent again.
git -C "$REPO" merge --ff-only "origin/$INITIAL_BRANCH" -q
OUT=$(run_hook "git checkout -b feature/five")
assert_silent "branch-create silent again once local is fast-forwarded" "$OUT"

# Test 16: an EXPLICIT start-point (git checkout -b <name> origin/<branch>) is not
# blocked even while local is stale — the command isn't relying on local's stale state.
advance_remote "b.txt" "landed again"
OUT=$(run_hook "git checkout -b feature/six origin/$INITIAL_BRANCH")
assert_silent "explicit start-point (origin/<branch>) skips the behind-check" "$OUT"

# Test 16b: same, but with an unrelated flag BEFORE the create flag (review, 2026-08-28) — the
# original position-counted extraction ("skip exactly 3 tokens") silently broke when a flag
# shifted the branch-name's position, wrongly denying a command that names an explicit
# start-point and isn't relying on local's stale state at all.
OUT=$(run_hook "git checkout -q -b feature/six-b origin/$INITIAL_BRANCH")
assert_silent "explicit start-point with a PRECEDING flag still skips the behind-check" "$OUT"

# Test 16c: attached-value create flag (-bfoo, no space) is still caught by the matcher AND
# still denies when appropriate (closes the other half of the same review finding).
OUT=$(run_hook "git checkout -bfeature/six-c")
assert_deny "attached-value create form (-bfoo) still denies when base is stale" "$OUT"

# Test 16e: attached-value create flag TOGETHER WITH an explicit start-point
# (`checkout -bfoo origin/main` — collapses to exactly 3 words, the shape most likely to
# fool a naive fixed-token-count extraction into treating origin/main as if it were the
# branch's own name). Second review pass, 2026-08-28.
OUT=$(run_hook "git checkout -bfeature/six-e origin/$INITIAL_BRANCH")
assert_silent "attached-value create WITH an explicit start-point still skips the behind-check" "$OUT"

# Test 16f: an EARLIER, unrelated checkout/switch must not hide a REAL create later in a
# compound command (second review pass, 2026-08-28) — exactly this todo's own incident shape
# (`git checkout main && git checkout -b feature/x`). The shared segment-finder
# (cmd_git_branch_create_segment) must pick the segment that actually carries the create
# flag, not simply the first "checkout|switch" occurrence.
OUT=$(run_hook "git checkout $INITIAL_BRANCH && git checkout -b feature/six-f")
assert_deny "an earlier unrelated checkout does not hide a later real create" "$OUT"

# Test 16g: CROSS 16f's axis (compound command hides the real create) with 16/16b/16e's axis
# (explicit start-point on the real create) — third review pass, 2026-08-28. Tested and passing
# independently is not sufficient here: with no start-point in EITHER segment, HAS_START_POINT
# computes to 0 regardless of which segment gets picked, so 16f alone cannot tell the new
# shared-segment extraction apart from the old buggy `head -1` one (mutation-verified: reverting
# branch-preflight.sh's extraction back to `head -1` still passes 16f, but wrongly DENIES this
# crossed case — the old code picks the wrong ("checkout main") segment, finds no start-point
# in IT, and denies even though the REAL create explicitly names one).
OUT=$(run_hook "git checkout $INITIAL_BRANCH && git checkout -b feature/six-g origin/$INITIAL_BRANCH")
assert_silent "an earlier unrelated checkout + explicit start-point on the real create still skips the behind-check" "$OUT"

# Test 16d: a branch tracking a DIFFERENTLY-NAMED remote branch (review, 2026-08-28) — the
# fetch refspec must be derived from branch.<name>.merge, not assumed equal to the local
# branch's own name, or this silently misses drift for any non-default tracking setup.
git -C "$REPO" branch --track wip "origin/$INITIAL_BRANCH" -q
git -C "$REPO" switch wip -q
advance_remote "e.txt" "landed while tracked under a different local name"
OUT=$(run_hook "git checkout -b feature/nine")
assert_deny "branch tracking a differently-named remote branch still detects drift" "$OUT"
git -C "$REPO" switch "$INITIAL_BRANCH" -q
git -C "$REPO" merge --ff-only "origin/$INITIAL_BRANCH" -q
git -C "$REPO" branch -D wip -q

# Test 17: a branch with no upstream configured → silent (nothing to compare against).
git -C "$REPO" switch -c topic/no-upstream -q
OUT=$(run_hook "git checkout -b feature/seven")
assert_silent "branching off a branch with no upstream is silent" "$OUT"
git -C "$REPO" switch "$INITIAL_BRANCH" -q 2>/dev/null

# Test 18: negative control — non-matching commands must NEVER fetch. Advance the remote
# once more, then prove the local remote-tracking ref is UNCHANGED after each command: if a
# fetch had run, this ref would have moved to the new commit. Silence alone doesn't prove
# this (a wrongly-attempted fetch could still fail open) — the ref position is the real proof.
advance_remote "c.txt" "sentinel commit"
REF_BEFORE=$(git -C "$REPO" rev-parse "refs/remotes/origin/$INITIAL_BRANCH")
run_hook "git branch -d somebranch" >/dev/null
run_hook "git status" >/dev/null
run_hook 'git commit -m "run git checkout -b later"' >/dev/null
run_hook "git checkout $INITIAL_BRANCH" >/dev/null
REF_AFTER=$(git -C "$REPO" rev-parse "refs/remotes/origin/$INITIAL_BRANCH")
if [ "$REF_BEFORE" = "$REF_AFTER" ]; then
  echo "PASS: non-matching commands never fetch (remote-tracking ref unchanged)"; PASS=$((PASS+1))
else
  echo "FAIL: a non-matching command fetched anyway (ref moved $REF_BEFORE -> $REF_AFTER)"
  FAIL=$((FAIL+1))
fi

# Test 19: a COMPOUND command matching BOTH check shapes (detached-HEAD commit AND a
# stale-base branch-create) must emit exactly ONE deny (check 1, detached-HEAD, wins —
# it's the data-loss check). Advance the remote again so check 2 would also fire alone.
advance_remote "d.txt" "landed a third time"
git -C "$REPO" checkout --detach HEAD -q 2>/dev/null
OUT=$(run_hook "git checkout -b feature/eight && git commit -m oops")
assert_deny "compound command matching BOTH checks still emits exactly one deny" "$OUT"
LINES=$(printf '%s' "$OUT" | grep -c '"permissionDecision"')
if [ "$LINES" = 1 ]; then
  echo "PASS: exactly one decision object emitted (not two concatenated)"; PASS=$((PASS+1))
else
  echo "FAIL: expected exactly 1 permissionDecision, got $LINES"; FAIL=$((FAIL+1))
fi
git -C "$REPO" switch "$INITIAL_BRANCH" -q 2>/dev/null
git -C "$REPO" merge --ff-only "origin/$INITIAL_BRANCH" -q 2>/dev/null

unset GIT_DIR GIT_WORK_TREE

# --- Hermeticity guard: prove the caller's real repo is byte-for-byte untouched. ---
# If an inherited GIT_DIR ever defeats the temp-repo isolation again, this fails loudly in
# CI/preflight instead of silently corrupting the working repo (the todos P2 git-churn bug).
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
