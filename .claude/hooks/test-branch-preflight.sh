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

# Test 8c: brace-grouped form (todos/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md) —
# `{ ...; }` executes its body in the CURRENT shell (no subshell), so this genuinely
# commits; the shared _CMD_POS_PREFIX previously omitted `{` as a valid opener. Still
# detached from Test 8/8b.
OUT=$(run_hook '{ git commit -m oops; }')
assert_deny "brace-grouped '{ git commit; }' on detached HEAD is denied" "$OUT"

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

# Test 10b: lib/cmd-detect.sh unsourceable + brace-grouped commit (`{ git commit -m x; }`) must
# STILL deny — the raw GIT_COMMIT_RE/COMPOUND_COMMIT_RE fallback previously only recognized
# start-of-string or &&/||/; before `git commit`, silently allowing exactly the shapes the
# 2026-08-29 primary-path widening was fixing (same NOLIB harness as Test 10; sibling case for
# the fallback path, not just the lib-sourced path Test 8c already covers).
NOLIB_INPUT=$(jq -n --arg c '{ git commit -m oops; }' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: brace-grouped '{ git commit; }' still denied (fail-closed)" "$OUT"

# Test 10c-10h: todos/P2-2026-08-29-branch-preflight-fallback-parity-gaps.md — the fallback was
# STILL not at parity with the primary path after Test 10b's brace/backtick/bang fix: a bare
# subshell, a newline-separated compound, a runner-word wrapper, and (COMPOUND_COMMIT_RE only) a
# `-c key=value` group were all still silently ALLOWED. Diffing the fallback's separator class
# against the primary path's `_CMD_POS_PREFIX` (rather than stopping at the four enumerated
# cases) found bare `|`/`&` were also missing. Same NOLIB harness as Test 10/10b.

# Test 10c: subshell-wrapped commit.
NOLIB_INPUT=$(jq -n --arg c '(git commit -m oops)' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: subshell '(git commit -m oops)' still denied (fail-closed)" "$OUT"

# Test 10d: newline-separated compound (real \n, no compound operator at all) — the OLD
# GIT_COMMIT_RE check used `[[ =~ ]]`, which anchors `^`/`$` to the WHOLE string, not per line.
NOLIB_INPUT=$(jq -n --arg c "$(printf 'git status\ngit commit -m oops')" '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: newline-separated 'git status<NL>git commit' still denied (fail-closed)" "$OUT"

# Test 10e: runner-word wrapper before the env assignment and verb.
NOLIB_INPUT=$(jq -n --arg c 'env FOO=1 git commit -m oops' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: runner-word 'env FOO=1 git commit' still denied (fail-closed)" "$OUT"

# Test 10f: compound form with a `-c key=value` group before `commit` — GIT_COMMIT_RE already
# had this group; COMPOUND_COMMIT_RE did not.
NOLIB_INPUT=$(jq -n --arg c 'true && git -c user.email=x commit -m oops' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: compound '-c' group 'git -c user.email=x commit' still denied (fail-closed)" "$OUT"

# Test 10g: bare pipe (the originally-deferred 5th gap from the Test 10b comment) — closed in
# the same pass as 10c-10f since it's the identical one-character separator-class widening.
NOLIB_INPUT=$(jq -n --arg c 'true | git commit -m oops' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: piped 'true | git commit' still denied (fail-closed)" "$OUT"

# Test 10h: bare & (backgrounded invocation) — found by diffing the fallback's separator class
# against the primary path's _CMD_POS_PREFIX; not one of the todo's four enumerated cases but
# the same defect shape, so closed alongside them.
NOLIB_INPUT=$(jq -n --arg c 'git status & git commit -m oops' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: backgrounded 'git status & git commit' still denied (fail-closed)" "$OUT"

# Test 10i-10k: the CROSS PRODUCT of [separator: &&/;/|] x [absorbed prefix: env-assignment /
# runner-word] before `git commit` — found live by two independent review passes on this same
# diff: 10c/10g/10h cover separator forms with NO absorbed prefix, and 10e covers an absorbed
# prefix at start-of-string (no separator), but the cell where BOTH combine had no fixture, and
# that is exactly where COMPOUND_COMMIT_RE was still missing the absorber group GIT_COMMIT_RE
# had (a first fix pass widened only GIT_COMMIT_RE's copy). A same-direction, one-axis-at-a-time
# corpus cannot exercise a co-occurrence bug — see
# docs/solutions/conventions/one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md.

# Test 10i: && separator + env-assignment absorbed by a runner word.
NOLIB_INPUT=$(jq -n --arg c 'true && env FOO=1 git commit -m oops' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: compound 'true && env FOO=1 git commit' still denied (fail-closed)" "$OUT"

# Test 10j: ; separator + a bare env-assignment (no runner word) before the verb.
NOLIB_INPUT=$(jq -n --arg c 'git status; FOO=1 git commit -m oops' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: compound 'git status; FOO=1 git commit' still denied (fail-closed)" "$OUT"

# Test 10k: | separator + a runner word (no env-assignment) before the verb.
NOLIB_INPUT=$(jq -n --arg c 'true | nohup git commit -m oops' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_deny "lib-missing: piped 'true | nohup git commit' still denied (fail-closed)" "$OUT"

# Test 10l: negative control for the whole NOLIB block (10, 10b-10k are all assert_deny — a
# mutation that made the fallback unconditionally DENY, e.g. IS_COMMIT=1 hoisted outside the
# if, would pass every one of them; nothing before this proved the fallback can also stay
# SILENT on a real non-commit command built from the SAME new separator+absorber widening).
# code-reviewer, round-2 review of this same widening. The command deliberately contains the
# literal substring "commit" (inside the -m message) so it still clears this hook's own
# necessary-substring fast path (line 32's `case "$CMD" in *commit*...`) and genuinely reaches
# the widened regex, rather than allowing vacuously via that earlier, unrelated filter — an
# initial version of this test used a command with no "commit"/"checkout"/"switch" substring
# at all and passed for the wrong reason (verified: it still passed even after `IS_COMMIT=1`
# was hoisted unconditionally, because the fast path exits long before that line runs).
NOLIB_INPUT=$(jq -n --arg c 'true && env FOO=1 git status -m "will commit later"' '{"tool_name":"Bash","tool_input":{"command":$c}}')
OUT=$(echo "$NOLIB_INPUT" | bash "$NOLIB/branch-preflight.sh" 2>/dev/null)
assert_silent "lib-missing: non-commit 'true && env FOO=1 git status -m ...commit...' is NOT denied" "$OUT"
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

# Tests 16d-16h (2026-09-01): END-TO-END proof for the redirect/comment terminator fix.
# These drive the real hook, not a copy of its start-point loop — the loop lives inline in
# this hook, so a unit test of cmd_git_branch_create_segment alone cannot show the
# consequence. Base is still stale here (advance_remote above), so the correct verdict for a
# command with NO explicit start-point is DENY.
#
# BEFORE the fix all three of these were SILENT: the leaked redirect/comment token was read
# by the consuming loop as a start-point, HAS_START_POINT flipped 0→1, and the whole
# stale-upstream block was skipped. `2>/dev/null` on a checkout is entirely ordinary, so
# this was a routine, non-adversarial way to lose the check.
OUT=$(run_hook "git checkout -b feature/six-d 2>/dev/null")
assert_deny "redirect (2>/dev/null) does not fake a start-point — stale-base deny still fires" "$OUT"

OUT=$(run_hook "git checkout -b feature/six-e >log.txt")
assert_deny "bare > redirect does not fake a start-point" "$OUT"

OUT=$(run_hook "git checkout -b feature/six-f # start from prod")
assert_deny "trailing # comment does not fake a start-point" "$OUT"

# The other side, and the one that would break if the terminator had merely been widened:
# a REAL explicit start-point must still suppress the check, including when a redirect
# follows it, and including a branch name containing a legal mid-word '#'.
OUT=$(run_hook "git checkout -b feature/six-g origin/$INITIAL_BRANCH 2>/dev/null")
assert_silent "explicit start-point followed by a redirect still skips the behind-check" "$OUT"

OUT=$(run_hook "git checkout -b issue#42 origin/$INITIAL_BRANCH")
assert_silent "a mid-word # in a real branch name does not truncate the start-point" "$OUT"

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

# --- Tests 20a-20k (2026-09-01): the hook must judge the RIGHT REPOSITORY --------------
# `git -C <path>` was invisible to every cmd_is_git_* matcher until now, so both checks above
# only ever ran against this hook's own cwd and were silently right by accident. Making the
# matcher see `-C` without also resolving the repo would have been a REGRESSION, not a fix:
# a correct command in another repo would be judged against this one. These pin the pairing
# end-to-end, against the real hook, because the resolution is consumed inline here — the
# lib-level pins in test-cmd-detect.sh cannot show the consequence.
#
# These run with cwd-based discovery and GIT_DIR/GIT_WORK_TREE UNSET, unlike the tests above.
# That is required, not stylistic: an exported GIT_DIR OVERRIDES `git -C`, so under this
# file's usual `export GIT_DIR=...` harness every `-C` here would be silently ignored and all
# eleven assertions would pass while testing nothing. (That override is also a real residual
# of the fix itself — an ambient GIT_DIR in the hook's own environment is unseeable at the
# command-string layer, the same residual git-safety.sh documents for its own -C handling.)
REPO_DETACHED=$(mktemp -d)
trap 'rm -rf "$REPO" "${BAREORIGIN:-}" "${REPO_DETACHED:-}"' EXIT
env -u GIT_DIR -u GIT_WORK_TREE git -C "$REPO_DETACHED" init -q
env -u GIT_DIR -u GIT_WORK_TREE git -C "$REPO_DETACHED" config user.email "t@t"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$REPO_DETACHED" config user.name "T"
echo y > "$REPO_DETACHED/y.txt"
env -u GIT_DIR -u GIT_WORK_TREE git -C "$REPO_DETACHED" add y.txt
env -u GIT_DIR -u GIT_WORK_TREE git -C "$REPO_DETACHED" commit -q -m init
env -u GIT_DIR -u GIT_WORK_TREE git -C "$REPO_DETACHED" checkout -q --detach HEAD

# run_hook_in <cwd> <command>
run_hook_in() {
  local dir="$1" cmd="$2" input
  input=$(jq -n --arg c "$cmd" '{"tool_name":"Bash","tool_input":{"command":$c}}')
  printf '%s' "$input" | env -u GIT_DIR -u GIT_WORK_TREE bash -c 'cd "$1" && bash "$2" 2>/dev/null' _ "$dir" "$HOOK"
}

# Harness control FIRST: if cwd-based discovery does not work here, every assertion below
# passes vacuously. Prove both verdicts are reachable through run_hook_in before using it.
OUT=$(run_hook_in "$REPO_DETACHED" "git commit -m x")
assert_deny "control: run_hook_in reaches a DENY via cwd discovery" "$OUT"
OUT=$(run_hook_in "$REPO" "git commit -m x")
assert_silent "control: run_hook_in reaches a SILENT via cwd discovery" "$OUT"

# THE FIX. A commit into a detached repo elsewhere was invisible; now it is judged there.
OUT=$(run_hook_in "$REPO" "git -C $REPO_DETACHED commit -m x")
assert_deny "a commit redirected by -C into a DETACHED repo is denied from a healthy cwd" "$OUT"

# The mirror, and the reason resolution is not optional: a commit into a HEALTHY repo must
# NOT inherit this cwd's detached verdict. Widening the matcher without resolving the repo
# would fail exactly here.
OUT=$(run_hook_in "$REPO_DETACHED" "git -C $REPO commit -m x")
assert_silent "a commit redirected by -C into a HEALTHY repo is silent from a detached cwd" "$OUT"

# DENY PRESERVATION. The second invocation really does commit in the detached cwd, and the
# gate denied on it before this change. Resolving the whole command to the -C target would
# turn that into an ALLOW — a deny→allow transition in a data-loss gate.
OUT=$(run_hook_in "$REPO_DETACHED" "git -C $REPO commit -m x && git commit -m y")
assert_deny "an unredirected commit alongside a redirected one still denies for THIS repo" "$OUT"

# Unresolvable redirects fall back to SKIP — the pre-2026-09-01 behaviour, never a guess.
OUT=$(run_hook_in "$REPO_DETACHED" 'git -C "$WORKTREE" commit -m x')
assert_silent "an unexpanded \$VAR -C path is skipped, not judged against cwd" "$OUT"
OUT=$(run_hook_in "$REPO_DETACHED" "git -C ../elsewhere commit -m x")
assert_silent "a relative -C path is skipped, not judged against cwd" "$OUT"
# A path that does not exist must not read as "detached" — every query returns empty there,
# which is indistinguishable from a detached HEAD without the per-check rev-parse probe.
OUT=$(run_hook_in "$REPO_DETACHED" "git -C /nonexistent/definitely commit -m x")
assert_silent "a -C path that is not a repo is skipped, not read as a detached HEAD" "$OUT"

# `-C` AFTER the verb is `git commit -C <commit>` (reuse that message) — a different flag.
# Mining it would route this gate away from cwd and silently drop a real data-loss deny.
OUT=$(run_hook_in "$REPO_DETACHED" "git commit -C HEAD")
assert_deny "a POST-verb -C (message reuse) still denies on a detached cwd" "$OUT"

# The other half of the anchor fix, end-to-end: a redirect before the command word, and a
# git global before the subcommand, were both invisible to the matcher.
OUT=$(run_hook_in "$REPO_DETACHED" "2>/dev/null git commit -m x")
assert_deny "a redirect BEFORE the command word no longer hides a detached-HEAD commit" "$OUT"
OUT=$(run_hook_in "$REPO_DETACHED" "git --no-pager commit -m x")
assert_deny "a git global before the subcommand no longer hides a detached-HEAD commit" "$OUT"

# THE REGRESSION THIS PAIRING ALMOST SHIPPED (CRITICAL, review 2026-09-01). An inline
# `GIT_DIR=`/`GIT_WORK_TREE=` assignment is swallowed by _CMD_POS_PREFIX's env absorber,
# which predates all of this — so unlike `-C`, these commands ALREADY matched and ALREADY
# denied. Filing them under "unresolvable, therefore skip, therefore no worse than before"
# was measurably false: base=DENY, head=ALLOW on a genuinely detached HEAD. The unit pin in
# test-cmd-detect.sh cannot catch it; only the consequence through the real hook can.
OUT=$(run_hook_in "$REPO_DETACHED" "GIT_DIR=.git git commit -m x")
assert_deny "an inline GIT_DIR= prefix still denies on a detached HEAD" "$OUT"
OUT=$(run_hook_in "$REPO_DETACHED" "GIT_WORK_TREE=. git commit -m x")
assert_deny "an inline GIT_WORK_TREE= prefix still denies on a detached HEAD" "$OUT"
OUT=$(run_hook_in "$REPO_DETACHED" "GIT_DIR=/elsewhere git commit -m x")
assert_deny "...including one naming another path — cwd is still judged, as it was before" "$OUT"
OUT=$(run_hook_in "$REPO_DETACHED" "git -c GIT_DIR=x commit -m y")
assert_deny "GIT_DIR= as a -c VALUE is not a redirect and must not drop the deny" "$OUT"
# The second CRITICAL: `(`/`)`/`{`/`}` are content inside a -c value, not control operators.
# Splitting on them severed `git` from its verb and skipped the gate on ONE real commit.
OUT=$(run_hook_in "$REPO_DETACHED" 'git -c core.hooksPath=$(pwd)/hooks commit -m x')
assert_deny "a \$(...) inside a -c value does not split the invocation away from the gate" "$OUT"
OUT=$(run_hook_in "$REPO_DETACHED" 'git -c foo.bar={a} commit -m x')
assert_deny "...nor do braces inside a -c value" "$OUT"
# The empty-redirect-target false DENY, the opposite direction: bash creates a FILE named
# `git` here and runs `commit`, so there is no git invocation to gate at all.
OUT=$(run_hook_in "$REPO_DETACHED" 'true && > git commit')
assert_silent "an empty redirect target is not a git invocation and must not deny" "$OUT"
# ...and the reason the fix is NOT a blanket "unresolvable => judge cwd": that would send a
# commit destined for another repo to be judged here.
OUT=$(run_hook_in "$REPO_DETACHED" 'git -C "$WORKTREE" commit -m x')
assert_silent "an unresolvable GLOBAL redirect is still skipped, not judged against cwd" "$OUT"

# LIB_OK must probe EVERY function the primary path calls. A lib defining cmd_is_git_commit
# but not cmd_git_repo_dir set LIB_OK=1, took the primary path, got 127 from the `$(…)`, left
# IS_COMMIT=0, and ALLOWED a plain detached-HEAD commit — the file header's fail-CLOSED
# promise silently bypassed (security review, 2026-09-01). Built by copying the real hook and
# lib and renaming ONE function away, so the fixture cannot drift from the real dependency.
PARTIAL=$(mktemp -d); mkdir -p "$PARTIAL/lib"
cp "$(dirname "$HOOK")/branch-preflight.sh" "$PARTIAL/branch-preflight.sh"
sed 's/^cmd_git_repo_dir()/cmd_git_repo_dir_RENAMED()/' \
  "$(dirname "$HOOK")/lib/cmd-detect.sh" > "$PARTIAL/lib/cmd-detect.sh"
run_partial() {
  jq -n --arg c "$1" '{"tool_name":"Bash","tool_input":{"command":$c}}' \
    | env -u GIT_DIR -u GIT_WORK_TREE bash -c 'cd "$1" && bash "$2/branch-preflight.sh" 2>/dev/null' \
        _ "$REPO_DETACHED" "$PARTIAL"
}
# Control first: the fixture must really be missing the function, or this passes vacuously.
if grep -q 'cmd_git_repo_dir_RENAMED' "$PARTIAL/lib/cmd-detect.sh" \
   && ! grep -q '^cmd_git_repo_dir()' "$PARTIAL/lib/cmd-detect.sh"; then
  echo "PASS: control — the partial-lib fixture really lacks cmd_git_repo_dir"; PASS=$((PASS+1))
else
  echo "FAIL: control — partial-lib fixture was not built; the pin below is vacuous"; FAIL=$((FAIL+1))
fi
OUT=$(run_partial "git commit -m x")
assert_deny "a lib missing cmd_git_repo_dir falls back to the raw regex and still DENIES" "$OUT"
rm -rf "$PARTIAL"

# CHECK 2 IS CWD-ONLY and must stay so. Following `-C` judged the wrong invocation's repo
# (`git --no-pager checkout main && git -C /other checkout -b foo` denied on cwd's staleness
# for a create that happens elsewhere: base ALLOW, new DENY) and made a PreToolUse hook fetch
# into, and write refs inside, a repo named only by an unapproved command string. $REPO is
# current here, so advance the remote first to make it stale again.
advance_remote "z.txt" "landed while we were looking at another repo"
OUT=$(run_hook_in "$REPO_DETACHED" "git -C $REPO checkout -b feature/ten")
assert_silent "the stale-base check does NOT follow -C into another repo" "$OUT"
REF_BEFORE_C=$(git -C "$REPO" rev-parse "refs/remotes/origin/$INITIAL_BRANCH")
run_hook_in "$REPO_DETACHED" "git -C $REPO checkout -b feature/eleven" >/dev/null
REF_AFTER_C=$(git -C "$REPO" rev-parse "refs/remotes/origin/$INITIAL_BRANCH")
if [ "$REF_BEFORE_C" = "$REF_AFTER_C" ]; then
  echo "PASS: ...and does not FETCH into a repo named only by the command string"; PASS=$((PASS+1))
else
  echo "FAIL: a -C command string caused a fetch that moved $REPO's remote-tracking ref"; FAIL=$((FAIL+1))
fi
# Control: with no redirect, the stale-base deny still fires from that same repo's own cwd.
OUT=$(run_hook_in "$REPO" "git checkout -b feature/twelve")
assert_deny "control — the stale-base deny still fires for a cwd-local create" "$OUT"
# THE FALSE DENY the cwd-only rule exists to prevent, and the only shape that discriminates
# it: cwd must be STALE (not detached, or check 2 short-circuits before the guard matters).
# `cmd_git_repo_dir` votes `.` on the unredirected `checkout main`, but the only CREATE is in
# the other repo — so judging cwd's staleness here denies a command that never branches here.
# Base allowed it because `--no-pager` and `-C` were both invisible to its stage 1.
OUT=$(run_hook_in "$REPO" "git --no-pager checkout $INITIAL_BRANCH && git -C $REPO_DETACHED checkout -b feature/thirteen")
assert_silent "a create redirected elsewhere is not judged against THIS repo's staleness" "$OUT"

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
