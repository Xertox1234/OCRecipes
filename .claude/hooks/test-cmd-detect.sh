#!/usr/bin/env bash
# Unit tests for lib/cmd-detect.sh's TWO renderings — run from anywhere.
#
# Pure string predicates: sources the lib and calls its functions on command
# STRINGS. Nothing is ever executed, so no git/gh/eas/railway process runs here.
#
# WHY THIS FILE EXISTS (2026-08-16): the lib had exactly one rendering,
# `cmd_bare`, which BLANKS quoted spans. A real shell word-splits `git "commit"`
# and concatenates `git com"mit"` into the same argv as the bare form, so
# blanking erased the verb before any matcher ran, so EVERY command-position
# detector in this lib went blind to a quoted command word.
#
# Closing it took TWO changes, and the second is easy to forget: the detectors
# now read `cmd_words`, AND every hook whose necessary-substring fast path globbed
# raw $CMD had to re-test a quote-stripped copy — otherwise the hook exits before
# its (now-fixed) matcher is ever asked. That affected commit-verify,
# drift-detect, drift-detect-update, pr-preflight-guard, branch-preflight and
# core-bare-guard; branch-preflight and pr-preflight-guard are blocking gates.
# (2026-09-02: that two-stage filter moved out of the 6 hooks above and
# guard-outward-cli.sh into the shared lib/fastpath-filter.sh — see
# todos/archive/P3-2026-08-16-extract-shared-fastpath-filter-helper.md. The final
# blocks in this file replace the old textual "grep for the inline block" scan
# with an EXECUTED probe per hook plus a mutation check, and retain a generic
# directory scan so a NEW hook that hand-rolls a raw single-stage filter still
# fails here instead of in prod.)
#
# The two renderings are NOT interchangeable and this file pins both directions:
# merging them re-breaks either flag-presence checks (a quoted `--auto` must not
# GRANT a carve-out) or the loose non-anchored matchers (which have no
# command-position anchor to suppress a mention with).
set -uo pipefail

HOOKDIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$HOOKDIR/lib/cmd-detect.sh"
FPLIB="$HOOKDIR/lib/fastpath-filter.sh"
PASS=0; FAIL=0

# PID-scoped session id for the "HERE resolution" block's drift-detect.sh/drift-detect-update.sh
# probes below (mirrors test-drift-detect.sh's own TEST_SESSION convention) — a fixed literal
# session id would collide across concurrent runs of this file and leak an uncleaned baseline
# file into /tmp (code review, 2026-09-02).
TEST_SESSION="test-cmd-detect-bare-here-probe-$$"
BARE_HERE_BASELINE="/tmp/claude-drift-detect-${TEST_SESSION}"
cleanup() {
  rm -f "$BARE_HERE_BASELINE"
}
trap cleanup EXIT

# Harness control: a probe that cannot see the thing it tests reports a clean
# bill of health. Prove the lib sourced and the functions exist before asserting.
# shellcheck source=/dev/null
. "$LIB" || { echo "FAIL: lib/cmd-detect.sh is not sourceable"; exit 1; }
for f in cmd_bare cmd_words cmd_extract_substitutions cmd_words_deep cmd_bare_deep \
         cmd_is_git_commit cmd_is_gh_pr_create cmd_is_git \
         cmd_is_git_commit_or_push cmd_is_git_head_mover cmd_is_git_branch_create \
         cmd_git_branch_create_segment cmd_git_repo_dir; do
  declare -F "$f" >/dev/null || { echo "FAIL: $f is not defined by the lib"; exit 1; }
done

# det <fn> <command> <yes|no> <label>
det() {
  local fn="$1" cmd="$2" want="$3" label="$4" got=no
  "$fn" "$cmd" && got=yes
  if [ "$got" = "$want" ]; then
    echo "PASS: $label"; PASS=$((PASS+1))
  else
    echo "FAIL: $label (got detected=$got, want $want)"; FAIL=$((FAIL+1))
  fi
}

# render <fn> <command> <expected-substring-present|absent> <needle> <label>
render() {
  local fn="$1" cmd="$2" mode="$3" needle="$4" label="$5" out
  out=$(printf '%s' "$cmd" | "$fn")
  if [ "$mode" = present ]; then
    if grep -qF -- "$needle" <<< "$out"; then echo "PASS: $label"; PASS=$((PASS+1))
    else echo "FAIL: $label (expected '$needle' in: $out)"; FAIL=$((FAIL+1)); fi
  else
    if grep -qF -- "$needle" <<< "$out"; then
      echo "FAIL: $label (unexpected '$needle' in: $out)"; FAIL=$((FAIL+1))
    else echo "PASS: $label"; PASS=$((PASS+1))
    fi
  fi
}

# render_arg <fn> <command> <expected-substring-present|absent> <needle> <label>
# Same as render(), but calls "$fn" "$cmd" (an ARGUMENT) rather than piping
# $cmd into $fn's stdin — cmd_words_deep's calling convention deliberately
# differs from cmd_bare/cmd_words (see its own header comment: it takes the
# command as $1, not stdin, because its body needs the text more than once).
render_arg() {
  local fn="$1" cmd="$2" mode="$3" needle="$4" label="$5" out
  out=$("$fn" "$cmd")
  if [ "$mode" = present ]; then
    if grep -qF -- "$needle" <<< "$out"; then echo "PASS: $label"; PASS=$((PASS+1))
    else echo "FAIL: $label (expected '$needle' in: $out)"; FAIL=$((FAIL+1)); fi
  else
    if grep -qF -- "$needle" <<< "$out"; then
      echo "FAIL: $label (unexpected '$needle' in: $out)"; FAIL=$((FAIL+1))
    else echo "PASS: $label"; PASS=$((PASS+1)); fi
  fi
}

echo "--- cmd_bare keeps blanking (its contract is UNCHANGED) ---"
# These pin the property that flag-presence checks and loose matchers depend on.
render cmd_bare 'gh pr merge 42 -b "use --auto next time"' absent '--auto' \
  "cmd_bare blanks a quoted --auto (carve-out decoy stays blanked)"
render cmd_bare 'echo "gh pr create"' absent 'gh pr create' \
  "cmd_bare blanks a quoted mention (loose matchers rely on this)"
render cmd_bare 'git commit -m x' present 'git commit' \
  "cmd_bare leaves unquoted words alone"

echo "--- cmd_words reproduces argv: quotes deleted, separators neutralised ---"
render cmd_words 'eas "update" --branch preview' present 'eas update' \
  "cmd_words rejoins a fully-quoted word"
render cmd_words 'eas up"date" --branch preview' present 'eas update' \
  "cmd_words rejoins a MID-WORD split (no fallback path catches this form)"
render cmd_words 'git commit -m "chore; eas update"' absent ';' \
  "cmd_words neutralises a separator INSIDE a span (stays data, not a new command)"
# A newline inside a span must not survive: grep's ^ is per-line, so it would
# hand `gh pr create` a start-of-line command position. It collapses to the same
# `x` placeholder as every other neutralised char, leaving ONE token.
render cmd_words 'git commit -m "wip
gh pr create"' present 'wipxghxprxcreate' \
  "cmd_words neutralises a NEWLINE inside a span (grep ^ is per-line)"

echo "--- THE ONE-WORD PROPERTY: a quoted span is exactly one argv word ---"
# Regression pins for the review finding that a space-bearing quoted value split
# one token into two, breaking the NAME=value absorber in _CMD_POS_PREFIX and
# letting the verb escape command position in EVERY consuming hook.
render cmd_words 'X="a b" eas update' present 'X=axb eas update' \
  "a space inside a span does not split the token"
render cmd_words "X='a b' eas update" present 'X=axb eas update' \
  "same for a single-quoted span"
render cmd_words 'gh pr merge 42 -b "use --auto next time"' absent ' --auto' \
  "a quoted --auto never becomes a standalone token (carve-out decoy)"
render cmd_words 'git commit -m "deny { eas update; } form"' absent '{' \
  "a brace inside a span cannot open a command position"
render cmd_words 'git commit -m "it works! npm publish"' absent '!' \
  "a bang inside a span cannot open a command position"
det cmd_is_git_commit 'GIT_AUTHOR_NAME="Will Tower" git commit -m x' yes \
  "env assignment with a spaced quoted value still detects the commit"
det cmd_is_git_head_mover 'GIT_EDITOR="code -w" git rebase -i main' yes \
  "env assignment with a spaced quoted value still detects a head-mover"
det cmd_is_gh_pr_create 'X="a b" gh pr create --title t' yes \
  "env assignment with a spaced quoted value still detects gh pr create"
render cmd_words 'echo hi; git commit' present ';' \
  "cmd_words keeps a separator OUTSIDE a span"

echo "--- the bypass: every anchored detector must see a quoted command word ---"
det cmd_is_git_commit       'git "commit" -m x'            yes "cmd_is_git_commit: git \"commit\""
det cmd_is_git_commit       'git com"mit" -m x'            yes "cmd_is_git_commit: git com\"mit\" (mid-word)"
det cmd_is_git_commit       '"git" commit -m x'            yes "cmd_is_git_commit: \"git\" commit"
det cmd_is_git_commit       "git 'commit' -m x"            yes "cmd_is_git_commit: single-quoted verb"
det cmd_is_gh_pr_create     'gh pr "create" --fill'        yes "cmd_is_gh_pr_create: gh pr \"create\""
det cmd_is_gh_pr_create     'gh "pr" create --fill'        yes "cmd_is_gh_pr_create: gh \"pr\" create"
det cmd_is_gh_pr_create     'gh pr cre"ate" --fill'        yes "cmd_is_gh_pr_create: mid-word"
# `git "status"` would NOT discriminate here — cmd_is_git only matches the word
# `git`, which is unquoted in that string, so it passed on the old code too.
# Split the word the matcher actually looks for.
det cmd_is_git              'g"i"t status'                 yes "cmd_is_git: quote splits the matched word"
det cmd_is_git              '"git" status'                 yes "cmd_is_git: fully-quoted matched word"
det cmd_is_git_commit_or_push 'git "push" origin main'     yes "cmd_is_git_commit_or_push: git \"push\""
det cmd_is_git_head_mover   'git "reset" --hard HEAD~1'    yes "cmd_is_git_head_mover: git \"reset\""
det cmd_is_git_head_mover   'git re"set" --hard HEAD~1'    yes "cmd_is_git_head_mover: mid-word"
det cmd_is_git_branch_create 'git checkout -b "new-feature"' yes \
  "cmd_is_git_branch_create: quoted branch name still detects the create flag"
det cmd_is_git_branch_create 'git check"out" -b foo'       yes "cmd_is_git_branch_create: mid-word verb"
# CRITICAL bypass class (found by review, 2026-08-28): the original regex required the create
# flag IMMEDIATELY adjacent to the subcommand with nothing attached and nothing intervening —
# both forms below are ordinary, common ways to type these commands, not exotic quoting tricks.
det cmd_is_git_branch_create 'git checkout -bfeature'       yes \
  "cmd_is_git_branch_create: attached-value form (-bfeature, no space) still detected"
det cmd_is_git_branch_create 'git checkout -Bfeature'       yes \
  "cmd_is_git_branch_create: attached-value force-create (-Bfeature) still detected"
det cmd_is_git_branch_create 'git switch -cfeature'         yes \
  "cmd_is_git_branch_create: attached-value switch form (-cfeature) still detected"
det cmd_is_git_branch_create 'git checkout -q -b feature'   yes \
  "cmd_is_git_branch_create: another flag BEFORE the create flag still detected"
det cmd_is_git_branch_create 'git checkout --track -b feature' yes \
  "cmd_is_git_branch_create: a long flag before the create flag still detected"
det cmd_is_git_branch_create 'git switch -q -c feature'     yes \
  "cmd_is_git_branch_create: switch with a preceding flag still detected"
# Regression from the FIX above (found by a second review pass, 2026-08-28): the loose
# segment-scan took only the FIRST "checkout|switch"-shaped occurrence (`head -1`), so a
# command containing an EARLIER, unrelated checkout/switch missed the REAL create later in
# the same line — exactly the 2026-08-28 incident's own shape (`checkout main && checkout -b`).
det cmd_is_git_branch_create 'git checkout main && git checkout -b foo' yes \
  "cmd_is_git_branch_create: an earlier unrelated checkout must not hide a later real create"
det cmd_is_git_branch_create 'git switch main2 && git checkout -b foo' yes \
  "cmd_is_git_branch_create: mixed keywords (switch then checkout) still finds the real create"
det cmd_is_git_branch_create 'grep checkout somefile && git checkout -b foo' yes \
  "cmd_is_git_branch_create: an unrelated command's own argument doesn't win over the real create"
det cmd_is_git_branch_create 'git checkout -b foo origin/main' yes \
  "cmd_is_git_branch_create: create with an explicit start-point still detected (sanity)"
# cmd_git_branch_create_segment's OWN terminator class does NOT simply mirror
# _CMD_POS_SUFFIX's closer set — see the two /code-review passes documented at the
# function definition, 2026-08-28. Two-sided: a backtick-wrapped create must be CLIPPED
# (trailing text after the closing backtick must not leak in), but a brace in a REAL
# branch name must NOT be clipped (a real git ref can contain `{`/`}` unquoted).
SEG_OUT=$(cmd_git_branch_create_segment '`git checkout -b foo` bar')
if [ "$SEG_OUT" = "checkout -b foo" ]; then
  echo "PASS: cmd_git_branch_create_segment: backtick closer does not leak trailing text into the segment"; PASS=$((PASS+1))
else
  echo "FAIL: cmd_git_branch_create_segment: expected 'checkout -b foo', got '$SEG_OUT'"; FAIL=$((FAIL+1))
fi
SEG_OUT=$(cmd_git_branch_create_segment 'git checkout -b feature/six{seven} origin/main')
if [ "$SEG_OUT" = "checkout -b feature/six{seven} origin/main" ]; then
  echo "PASS: cmd_git_branch_create_segment: a brace in a REAL branch name is not truncated (explicit start-point preserved)"; PASS=$((PASS+1))
else
  echo "FAIL: cmd_git_branch_create_segment: expected the full segment with origin/main preserved, got '$SEG_OUT'"; FAIL=$((FAIL+1))
fi

# REDIRECTS AND WORD-START COMMENTS (2026-09-01). Same two-sided shape as the brace/backtick
# pair above, for the three characters the function's header used to list as a known gap.
# The CLIP direction: an ordinary redirect or trailing comment must not leak a spurious
# start-point token into the segment (that flipped branch-preflight's HAS_START_POINT 0→1
# and SKIPPED the stale-upstream check). The PRESERVE direction matters just as much and is
# why a plain character-class widening was wrong: `git check-ref-format --branch` accepts
# `foo#bar`, `foo<bar` and `foo>bar`, `issue#42` is a legal branch name that bash keeps
# literal mid-word, and a pure-digit trailing token is a real abbreviated-SHA start point.
seg_clip() {  # <command> <expected-segment-after-trimming> <label>
  local got; got=$(cmd_git_branch_create_segment "$1")
  got="${got%"${got##*[![:space:]]}"}"   # rtrim: the rewrite leaves the separator's space
  if [ "$got" = "$2" ]; then
    echo "PASS: cmd_git_branch_create_segment: $3"; PASS=$((PASS+1))
  else
    echo "FAIL: cmd_git_branch_create_segment: $3 — expected '$2', got '$got'"; FAIL=$((FAIL+1))
  fi
}
# CLIP: the redirect (with its fd prefix) and the comment must not reach the segment.
seg_clip 'git checkout -b foo 2>/dev/null'   'checkout -b foo' 'fd-prefixed redirect (2>) is clipped, fd digit included'
seg_clip 'git checkout -b foo >log.txt'      'checkout -b foo' 'bare > redirect is clipped'
seg_clip 'git checkout -b foo 1>>out.log'    'checkout -b foo' 'append redirect (1>>) is clipped'
seg_clip 'git checkout -b foo 2>&1'          'checkout -b foo' 'fd-dup redirect (2>&1) is clipped'
seg_clip 'git checkout -b foo # from prod'   'checkout -b foo' 'word-start # begins a comment and is clipped'
seg_clip 'git switch -c foo 2>/dev/null'     'switch -c foo'   'switch -c form is clipped the same way'
# PRESERVE: none of these may be truncated — each would be a repeat of the `{`/`}` regression.
seg_clip 'git checkout -b issue#42 origin/main'  'checkout -b issue#42 origin/main' \
  'a MID-WORD # is legal ref content and is NOT a boundary (start-point preserved)'
seg_clip 'git checkout -b release/2.0 origin/main' 'checkout -b release/2.0 origin/main' \
  'a digit in a real branch name is not mistaken for an fd prefix'
seg_clip 'git checkout -b foo 1234567'       'checkout -b foo 1234567' \
  'a pure-digit start-point (abbreviated SHA) is not stripped as an fd prefix'
seg_clip 'git checkout -b foo2 origin/main'  'checkout -b foo2 origin/main' \
  'a branch name ending in a digit is preserved'
seg_clip 'git checkout -b foo origin/main 2>/dev/null' 'checkout -b foo origin/main' \
  'a redirect AFTER a real start-point clips only the redirect'
seg_clip 'git checkout -b foo </dev/null'    'checkout -b foo' 'input redirect (<) is clipped too'
seg_clip 'git checkout -b foo > log.txt'     'checkout -b foo' 'space-separated redirect target is clipped'

# DETECTION-SUPERSET PINS (2026-09-01, added after a security review found the first version
# of the redirect fix REMOVED detections). The rule these enforce: a change to this matcher
# may ADD a detection, never remove one — every command below really does create a branch,
# so cmd_is_git_branch_create MUST say yes for all of them.
#
# The first fix rewrote a redirect to `;`. Bash allows a redirection ANYWHERE in a simple
# command, so `git checkout 2>/dev/null -b foo` became `checkout ;/dev/null -b foo`, the
# extractor stopped at the injected `;` BEFORE `-b`, found no create flag, and reported "not
# a create" for a real one — a deny→allow hole in the gate the change was hardening.
# Injecting a terminator at a computed offset IS a positional widening of the terminator
# class. These pins exist so that shape can never return silently.
#
# Note why the earlier suite could not catch it: every clip pin above puts the redirect
# AFTER the create flag. 833 assertions stayed green over two live bypasses.
det cmd_is_git_branch_create 'git checkout 2>/dev/null -b foo'    yes \
  "redirect BEFORE the create flag is still a real create"
det cmd_is_git_branch_create 'git checkout >/dev/null -b foo'     yes \
  "bare redirect before the create flag is still a real create"
det cmd_is_git_branch_create 'git switch 2>/dev/null -c foo'      yes \
  "redirect before the create flag, switch -c form"
det cmd_is_git_branch_create 'git checkout -q 2>/dev/null -b foo' yes \
  "flag, then redirect, then create flag"

# A QUOTED word-start '#' must not read as a comment. cmd_words deletes the quote
# characters, so before `#` was added to its neutral() set a quoted '#' was indistinguishable
# from a real comment and the greedy `#.*$` rewrite ate the rest of the line — including a
# real create later in the command. All three quote flavours, because neutral() is applied in
# all three quoted states. A commit message starting with an issue number is ordinary usage.
det cmd_is_git_branch_create 'git commit -m "#123 fix the thing" && git checkout -b feature/x' yes \
  "double-quoted leading # is not a comment — the later create is still detected"
det cmd_is_git_branch_create "git commit -m '#123 fix the thing' && git checkout -b feature/x" yes \
  "single-quoted leading # is not a comment — the later create is still detected"
det cmd_is_git_branch_create 'git commit -m $'"'"'#123 fix'"'"' && git checkout -b foo' yes \
  "ANSI-C quoted leading # is not a comment — the later create is still detected"
# Same root cause, redirect side: a quoted < or > is literal argv, not redirection.
# SCOPE NOTE (review, 2026-09-01): these two are DETECTION pins only. They were mutation-
# checked and they do NOT independently guard the neutral() addition — with the delete-based
# redirect sed in place, `-b foo` survives whether or not the quoted `>` was neutralised, and
# cmd_is_git_branch_create only asks "is there a create flag", not "is the segment faithful".
# They go red only when BOTH repairs are reverted. What actually guards neutral() for these
# characters is the seg_clip PRESERVE block below, which asserts segment CONTENT. Kept because
# they pin the end-user-visible property; do not read them as covering neutral() on their own.
det cmd_is_git_branch_create 'git checkout 2">"/dev/null -b foo' yes \
  "a quoted > is literal argv, not a redirect — the create is still detected"
det cmd_is_git_branch_create 'git checkout ">x" -b foo'          yes \
  "a quoted > as a whole word is literal argv — the create is still detected"

# PRESERVE direction — this block is the real guard for the neutral() addition. A legal ref
# name starting with <, > or # keeps its start-point instead of being clipped as syntax.
# All THREE added characters are covered: dropping any one of them from neutral() must turn
# a pin here red (verified by mutation — `<` previously had no pin at all and could be
# dropped with zero failures anywhere in the suite).
#
# These assert on cmd_words' placeholder byte (`x`, its PH constant). That is a deliberate
# two-hop coupling: the property under test is "the token survived, unclipped", and the exact
# byte is an implementation detail of a DIFFERENT function. If PH is ever changed, update
# these expectations — the pins are not wrong, they are downstream.
seg_clip 'git checkout -b foo ">bar"'   'checkout -b foo xbar' \
  'a quoted >bar is a legal ref name and survives as a start-point (neutralised, not clipped)'
seg_clip 'git checkout -b foo "<bar"'   'checkout -b foo xbar' \
  'a quoted <bar is a legal ref name and survives as a start-point (the < half of neutral())'
seg_clip 'git checkout -b foo "#weird"' 'checkout -b foo xweird' \
  'a quoted #weird is a legal ref name and survives as a start-point'

# ---------------------------------------------------------------------------
# COMBINATORIAL DETECTION-SUPERSET CORPUS (2026-09-01, review round 2)
#
# This block is the committed form of the differential that review demanded. It is NOT
# written as "replay against main" on purpose: once this branch merges, main == HEAD and such
# a test silently passes forever — a fail-open gate. Instead it pins the INVARIANT the
# differential was measuring: every command below is a create-SHAPED command that a
# pre-execution gate must flag, so cmd_is_git_branch_create must say yes for all of them,
# whatever the extraction internals become. ("Every one of them creates a branch" would be
# an overclaim — in the `||` quarter, `git checkout main ... || git switch -c foo` runs the
# create only if the first clause fails. That is the correct thing to flag anyway: a gate
# that must decide BEFORE execution cannot know which side of a `||` will run, and the
# fail-closed direction is to treat the create as reachable.)
#
# The family exists because the first DELETING sed wrote its target word as `[^[:space:]]*`,
# excluding only whitespace — so it also consumed `;`, `&`, `|`, `)` and backtick, which are
# the extractor's own segment boundaries. A redirect ending a clause with NO space before the
# separator deleted the separator, fusing two clauses into one segment; the `case` then
# dispatched on the merged segment's first verb and never searched for the second.
# 240 deny→allow transitions over a 2189-input corpus (10 redirect forms × 4 unspaced
# separators × 6 verb-mismatched pairs) — a larger corpus than the 48 generated below, which
# pin the family rather than re-measure it. The verb-MISMATCHED pairs (checkout-then-switch and the
# reverse) are the load-bearing ones — a same-verb pair still finds its create flag by
# accident and would have hidden the bug.
for _redir in '2>/dev/null' '>log' '1>>out' '2>&1' '>|log' '</dev/null' '&>/dev/null' '&>>log'; do
  # `|cat;` NOT `|tee x;` — verified, not assumed. The buggy class this corpus guards against
  # (`[^[:space:]]*`) stops at the FIRST whitespace, so a separator containing an internal
  # space (`|tee x;`) halts the over-consumption before it ever reaches the `;` boundary the
  # bug is about: all 12 such pins passed under both the correct and the buggy lib. A
  # separator whose text has no internal space before the boundary is what discriminates.
  for _sep in ';' '&&' '||' '|cat;'; do
    for _pair in 'checkout main|switch -c foo' 'switch main|checkout -b foo'; do
      _first=${_pair%%|*}; _second=${_pair##*|}
      det cmd_is_git_branch_create "git ${_first} ${_redir}${_sep}git ${_second}" yes \
        "corpus: 'git ${_first} ${_redir}${_sep}git ${_second}' still detected (unspaced separator after a redirect must not fuse clauses)"
    done
  done
done
# SLOT-POSITION dimension (review round 3). Everything above pins the redirect at the END of
# clause 1, with the create in the OTHER clause — so the corpus was structurally unable to
# exercise the one remaining code risk, the `[[:space:]]*<word>` target skip, which can only
# damage tokens in the clause the redirect is IN. This block puts the redirect at each slot
# inside the create clause itself. It is also what the `&>` family needed: `&>` was invisible
# to the old operator class `[0-9]*[<>]+` (no leading `&`), so `git checkout &>/dev/null -b
# foo` — a real create — reported not-a-create, and the suite stayed green because no pin put
# a redirect there.
for _r in '2>/dev/null' '&>/dev/null' '>|log' '2>&1'; do
  # The two slots this loop used to skip are now covered (2026-09-01). The old note here
  # said `git 2>/dev/null checkout -b foo` was a real create reported as not-a-create, left
  # unpinned because fixing it meant widening the SHARED _CMD_POS_PREFIX and the then-current
  # Scope Contract forbade that. The anchor has since been widened, so the residual is a pin.
  det cmd_is_git_branch_create "git ${_r} checkout -b foo"      yes "slot: redirect BEFORE the subcommand (${_r})"
  det cmd_is_git_branch_create "${_r} git checkout -b foo"      yes "slot: redirect BEFORE the command word (${_r})"
  det cmd_is_git_branch_create "git checkout ${_r} -b foo"      yes "slot: redirect before the create FLAG (${_r})"
  det cmd_is_git_branch_create "git checkout -b ${_r} foo"      yes "slot: redirect between flag and name (${_r})"
  det cmd_is_git_branch_create "git checkout -b foo ${_r}"      yes "slot: redirect after the name (${_r})"
  seg_clip "git checkout -b foo ${_r} origin/main" 'checkout -b foo  origin/main' \
    "slot: a real start-point after ${_r} survives"
done

# SPACING dimension (review round 4, 2026-09-01 — a CRITICAL). Every ${_r} above has
# whitespace baked into its template, so the corpus could not see a redirect GLUED to the
# preceding word. That is not a cosmetic variant: `&` and `|` are in this extractor's own
# terminator class, so a glued `&>`/`>&`/`>|` TRUNCATES the segment before the create flag and
# a real create reports not-a-create. Verified by running git in a scratch repo —
# `git checkout main&>/dev/null -b foo` and `git checkout -b foo&>/dev/null` both create the
# branch. The round-3 fix required `(^|[[:space:]])` before the whole redirect, which is right
# for the fd DIGITS and wrong for everything else; hence two sed expressions.
#
# The SUBCOMMAND slot (`git checkout>&2 -b foo`) is NOT pinned here. It fails one step
# earlier, in stage 1's `_CMD_POS_SUFFIX` anchor, which this todo's Scope Contract forbids
# touching — a separate defect with a separate fix, not something this sed can reach.
for _r in '&>/dev/null' '&>>log' '>&2' '>|log' '>/dev/null' '2>/dev/null' '&>|log'; do
  det cmd_is_git_branch_create "git checkout main${_r} -b foo"  yes "glued to the start-point word (${_r})"
  det cmd_is_git_branch_create "git switch main${_r} -c foo"    yes "glued, switch form (${_r})"
  det cmd_is_git_branch_create "git checkout -b foo${_r}"       yes "glued to the new branch NAME (${_r})"
done
# The other direction: deleting a glued redirect must not eat a REAL start-point.
for _r in '&>/dev/null' '&>>log' '>&2' '>|log' '>/dev/null' '&>|log'; do
  seg_clip "git checkout -b foo${_r} origin/main" 'checkout -b foo origin/main' \
    "a real start-point after a GLUED ${_r} survives"
done
# The fd-DIGIT form is pinned SEPARATELY and deliberately, because bash attaches the digit to
# the PRECEDING word rather than to the operator, and that flips the answer by slot:
#   name slot      — `git checkout -b foo2>/dev/null` creates a branch called `foo2` (ran it).
#   subcommand slot — `git checkout2>/dev/null -b foo` invokes `git checkout2`, which git
#                     rejects: "'checkout2' is not a git command", exit 1, nothing created.
# Folding either into the loops above would have pinned a wrong answer as if it were the fix.
seg_clip 'git checkout -b foo2>/dev/null origin/main' 'checkout -b foo2 origin/main' \
  'a glued fd DIGIT stays part of the branch NAME (bash creates foo2), start-point intact'
det cmd_is_git_branch_create 'git checkout2>/dev/null -b foo' no \
  'a glued fd digit makes it `git checkout2`, which is not a git command at all'
det cmd_is_git_branch_create 'git switch2>>log -c foo'        no \
  '...same for the switch form'

# The clip direction of the same defect: an eaten separator also glued the NEXT clause's first
# token in as a spurious start-point, so the stale-base check was skipped on a command that
# named no start point at all — the exact bug this whole todo exists to close, surviving in
# the unspaced form.
seg_clip 'git checkout -b foo 2>/dev/null;git push'    'checkout -b foo' \
  'an unspaced separator after a redirect does not glue the next clause in as a start-point'
seg_clip 'git checkout -b foo >/dev/null&&npm test'    'checkout -b foo' \
  'same, with && and no spaces'
seg_clip 'git checkout -b foo 2>/dev/null|tee log'     'checkout -b foo' \
  'same, with a pipe'
# The `[&|]?` half of the redirect pattern had NO pin until review round 3 — reverting it to
# `&?` alone left the whole 898-assertion suite green. `>|` is bash's noclobber-override
# redirect: with `&?` the `|` is not consumed as part of the operator, the target-word class
# then stops dead at it, and the REAL start-point after it is dropped — the exact
# HAS_START_POINT flip this entire todo exists to prevent. Two spaces in the expectation are
# real: the deletion leaves the separator space plus the space before the start-point.
seg_clip 'git checkout -b foo >|log origin/main' 'checkout -b foo  origin/main' \
  'the noclobber >| operator is consumed as one unit and a real start-point after it survives'

echo "--- _CMD_POS_PREFIX/_CMD_POS_SUFFIX: brace/backtick/bang/separator boundaries ---"
# The shared anchor omitted `{`, backtick, and `!` as openers, and `;`/`&`/`|`/backtick/
# `{`/`}` as closers — so a brace-grouped, backtick-substituted, `!`-prefixed, or
# no-space-before-separator REAL invocation was invisible to every cmd_is_*
# matcher (found by /code-review of PR #850, 2026-08-17). `{ ...; }` executes its body
# in the CURRENT shell (no subshell) and a backtick span runs its contents as a command
# substitution — both genuinely invoke git/gh, so these are real ALLOW-when-should-DENY
# gaps. Mirrors the identical widening test-guard-outward-cli.sh already pins for the
# sibling _OUT_POS_PREFIX/_OUT_POS_SUFFIX (test-guard-outward-cli.sh:428-435).
det cmd_is_git_commit   '{ git commit -m x; }'         yes "cmd_is_git_commit: brace-grouped opener"
det cmd_is_git_commit   '`git commit -m x`'            yes "cmd_is_git_commit: backtick-substituted opener"
det cmd_is_git_commit   '! git commit -m x'             yes "cmd_is_git_commit: bang-prefixed opener"
det cmd_is_git_commit   'git commit;date'               yes "cmd_is_git_commit: no-space-before-';' closer"
det cmd_is_git_commit   'git commit&'                    yes "cmd_is_git_commit: no-space '&' closer"
det cmd_is_gh_pr_create 'gh pr create|cat'                yes "cmd_is_gh_pr_create: no-space '|' closer"
det cmd_is_gh_pr_create '{ gh pr create --fill; }'      yes "cmd_is_gh_pr_create: brace-grouped opener"
det cmd_is_gh_pr_create '`gh pr create --fill`'         yes "cmd_is_gh_pr_create: backtick-substituted opener"
det cmd_is_gh_pr_create '! gh pr create --fill'          yes "cmd_is_gh_pr_create: bang-prefixed opener"
det cmd_is_gh_pr_create 'gh pr create;date'              yes "cmd_is_gh_pr_create: no-space-before-';' closer"
# AC-required closer widening (`{`/`}`) is wider than guard-outward-cli.sh's own
# _OUT_POS_SUFFIX, which omits them — pin the newly-accepted shape per
# docs/solutions/best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md
# ("regression-test the newly-matched inputs, not just the false-positives removed").
det cmd_is_git_commit   '{git commit}'                   yes "cmd_is_git_commit: no-space brace open+close (AC-required, not a real bash form)"
# Two-sided negative controls: the SAME characters, fully inside a quoted span, must
# stay undetected — the widened anchor only opens/closes on REAL (unquoted) syntax.
det cmd_is_gh_pr_create 'git commit -m "deny { gh pr create; } form"'  no \
  "brace-wrapped mention fully inside quotes stays undetected"
det cmd_is_gh_pr_create 'git commit -m "it works! gh pr create now"'   no \
  "bang-prefixed mention fully inside quotes stays undetected"
det cmd_is_gh_pr_create 'git commit -m "see \`gh pr create\` in backticks"' no \
  "backtick-wrapped mention fully inside quotes stays undetected"
# KNOWN RESIDUAL (harmless, documented at the anchor definition): combining `{` as an
# opener with `}` as a closer also satisfies a bash parameter expansion whose variable
# name equals a matched verb — NOT limited to cmd_is_git (every anchored matcher can
# fire this way; the anchor matches rendered TEXT, not valid bash syntax, and
# `${verb subcommand}` is not valid parameter-expansion syntax to begin with, so this
# never corresponds to a real invocation). Stays harmless because every current
# consumer is either DENY-shaped (over-triggering is the safe direction) or
# advisory-only (core-bare-guard.sh's cmd_is_git — always exits 0, never denies).
# Pinned here as a KNOWN accepted gap, not a silent one.
det cmd_is_git '${git} status' yes \
  "KNOWN RESIDUAL: \${git} parameter expansion spuriously satisfies cmd_is_git (harmless — core-bare-guard.sh never denies)"
det cmd_is_git_commit '${git commit}' yes \
  "KNOWN RESIDUAL: not cmd_is_git-only — \${git commit} spuriously satisfies cmd_is_git_commit too (harmless — DENY-shaped consumer, safe direction)"
# cmd_is_git had zero negative controls before this todo despite taking the LARGEST
# behavioral delta of any matcher in the file (no verb-specific tail to anchor
# against) — found by the todo-researcher. Pin one now.
det cmd_is_git 'echo "git status later"' no \
  "cmd_is_git: quoted mention stays undetected (first negative control for this matcher)"
# Backtick as a CLOSER, not just an opener: the no-trailing-args form `` `git commit` ``
# has the closing backtick immediately after the verb with nothing to give a whitespace
# suffix — found by the todo-researcher as unexercised by the six required repro cases.
det cmd_is_git_commit '`git commit`' yes \
  "cmd_is_git_commit: backtick as CLOSER (no-args form, closing backtick immediately after verb)"

echo "--- negative controls: bare forms still detected (probe can see anything) ---"
det cmd_is_git_commit   'git commit -m x'      yes "bare git commit still detected"
det cmd_is_gh_pr_create 'gh pr create --fill'  yes "bare gh pr create still detected"
det cmd_is_git_branch_create 'git checkout -b foo'   yes "bare 'checkout -b' still detected"
det cmd_is_git_branch_create 'git checkout -B foo'   yes "bare 'checkout -B' (force-create) still detected"
det cmd_is_git_branch_create 'git switch -c foo'     yes "bare 'switch -c' still detected"
det cmd_is_git_branch_create 'git switch -C foo'     yes "bare 'switch -C' (force-create) still detected"
det cmd_is_git_branch_create 'git checkout -b foo && git commit -m x' yes \
  "compound: a real branch-create earlier in the line is still detected"

echo "--- negative controls: MENTIONS must stay undetected (no new false denies) ---"
# These are the cases blanking was introduced to protect. cmd_words keeps the
# words, so the COMMAND-POSITION ANCHOR is what has to suppress them — pin it.
det cmd_is_git_commit   'echo "run git commit later"'          no "mention inside echo stays undetected"
det cmd_is_git_commit   'git log --grep "commit"'              no "flag value 'commit' stays undetected"
det cmd_is_gh_pr_create 'git commit -m "then gh pr create"'    no "mention in a commit message stays undetected"
det cmd_is_gh_pr_create 'git commit -m "chore; gh pr create"'  no "SEPARATOR in a commit message does not open a command position"
det cmd_is_git_head_mover 'echo "git reset --hard is bad"'     no "mention of a head-mover stays undetected"
det cmd_is_git_commit   'git commit -m "a" && echo done'       yes "real commit with a quoted arg still detected"
det cmd_is_git_branch_create 'echo "git checkout -b foo later"'      no "mention inside echo stays undetected"
det cmd_is_git_branch_create 'git commit -m "git checkout -b foo"'   no "mention in a commit message stays undetected"
det cmd_is_git_branch_create 'git checkout foo'                      no "checking out an EXISTING branch (no -b/-B) is not a create"
det cmd_is_git_branch_create 'git branch foo'                        no \
  "scope gap, deliberate: plain 'git branch <name>' (create-without-switching) is NOT matched — rarer form, ambiguous vs. -d/-D/-m/--list"

echo "--- cmd_git_branch_create_segment: a decoy SUBSTRING must not win over a later REAL create ---"
# Un-anchored checkout/switch matching (fixed 2026-09-02,
# todos/P3-2026-08-28-branch-create-segment-decoy-substring-false-negative.md): the extraction
# regex required only the literal text `checkout`/`switch` immediately followed by whitespace,
# with no boundary before it — so a decoy TOKEN where that text is a trailing SUBSTRING of a
# longer word (`gcheckout`, glued, no real separator) satisfied the pattern exactly like a real
# invocation. A command carrying BOTH a decoy shaped like this (with its OWN create flag, so the
# loop's flag-presence check also passes on it) AND a real create LATER in the same command is
# the co-occurrence this bug needed — neither a decoy alone nor a real create alone reproduces
# it, so a corpus that varies only one of them at a time cannot reach this class. See
# docs/solutions/conventions/one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md.
#
# `cmd_is_git_branch_create`'s own boolean is NOT the right assertion for this bug: the decoy and
# the real segment both carry a create flag of the SAME class, so the boolean returns "yes"
# whichever one the loop actually picks — it agrees with the correct answer for an unrelated
# reason (confirmed by mutation: every `det cmd_is_git_branch_create` pin in this file still
# passes against the pre-fix regex). The bug is only observable in WHICH STRING
# `cmd_git_branch_create_segment` returns, because branch-preflight.sh reads that string back out
# as the start-point token — so every pin below asserts on segment CONTENT via seg_clip, not on
# the boolean, and was confirmed to go RED against the pre-fix regex before being kept (mutation:
# stub the anchor back to bare `(checkout|switch)[[:space:]]+…`, rerun — every pin in the loop
# below reported the decoy's own content instead of the real segment; restore, rerun, all green).
#
# Generated from independent dimensions rather than hand-listed (a hand-listed corpus reproduces
# the author's own blind spot): the decoy's glued PREFIX word, the decoy's VERB shape (which also
# picks its own flag class, -b vs -c), the REAL create's verb — deliberately allowed to MISMATCH
# the decoy's, since a same-verb pair can look coincidentally right even with the bug present —
# and the separator, both unspaced (this file's own established "no space before the boundary"
# dimension, see the SPACING section above) and spaced (the todo's own literal repro shape).
for _prefix in 'g' 'my'; do
  for _decoy_verb in 'checkout:-b' 'switch:-c'; do
    _dverb=${_decoy_verb%%:*}; _dflag=${_decoy_verb##*:}
    for _real_verb in 'checkout:-b' 'switch:-c'; do
      _rverb=${_real_verb%%:*}; _rflag=${_real_verb##*:}
      _decoy="${_prefix}${_dverb} ${_dflag} decoy origin/main"
      _real="${_rverb} ${_rflag} real"
      seg_clip "${_decoy};git ${_real}" "$_real" \
        "decoy '${_prefix}${_dverb}' (unspaced ;) does not shadow a real '${_rverb}' create (decoy=${_dverb}, real=${_rverb})"
      seg_clip "${_decoy} && git ${_real}" "$_real" \
        "decoy '${_prefix}${_dverb}' (spaced &&) does not shadow a real '${_rverb}' create (decoy=${_dverb}, real=${_rverb})"
    done
  done
done

# The todo's own literal repro, pinned directly for traceability back to the filed bug report.
seg_clip 'gcheckout -b decoy origin/main && git checkout -b real' 'checkout -b real' \
  "todo repro: a 'gcheckout' decoy does not shadow the real 'git checkout -b' that follows"

# Sanity: reversed order (real create FIRST, decoy second) was never buggy — the loop returns on
# the first flag-carrying segment either way — but pin it so the boundary anchor doesn't
# accidentally break the common, unproblematic ordering too.
seg_clip 'git checkout -b real && gcheckout -b decoy origin/main' 'checkout -b real' \
  "sanity: a real create before an unrelated decoy is unaffected by the anchor"

# Control: a decoy with NO matching create flag was never buggy either (the loop's own
# flag-presence check already skips it) — pin it so the anchor doesn't OVER-reject and still
# finds the real create behind a harmless decoy mention.
seg_clip 'gcheckout main && git checkout -b real' 'checkout -b real' \
  "control: a flagless decoy mention was already harmless; the real create is still found"

# GLUE-CHARACTER dimension (review round 2, 2026-09-02 — CRITICAL/WARNING, code-reviewer and
# security-auditor independently constructed and ran the SAME live bypass on the first version
# of this fix). The corpus above varies the decoy's PREFIX word but fixes the glue between that
# prefix and the decoy verb at "none" (an alphanumeric character glued directly, `gcheckout`) —
# it never generated over the boundary whitelist's OWN new alternation, which is exactly the
# axis review found broken: `!`, `{`, `}` were in the first version's whitelist (copied from
# `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`, which use a wider class for a different, whitespace-gated
# purpose) even though none of them separates a word when GLUED with no space — `x!checkout`,
# `x{checkout`, `x}checkout` each tokenize as ONE literal command word in real bash (confirmed by
# running each: `bash -c 'checkout(){ :;}; x!checkout -b x'` -> `bash: x!checkout: command not
# found`; identical for the other two) and never invoke `checkout`/`switch` at all — so admitting
# them as boundaries reopened the exact decoy-shadows-a-later-real-create bug this fix exists to
# close, just via a different glue character than the todo's own `gcheckout` repro. Mutation-
# tested: reverting the boundary class to include `!{}` (the first version) turns every pin in
# this loop RED with the decoy's own content, not the real segment; the current class turns them
# GREEN. `<`/`>` are pinned too, as a CONTROL that they are harmless despite being excluded from
# the final whitelist: the redirect-stripping `sed` two stages above deletes them together with
# their whole target — including `checkout` itself when glued — before this `grep` ever runs, so
# they can never reach it as live boundary text either way.
for _glue in '!' '{' '}' '<' '>'; do
  seg_clip "x${_glue}checkout -b decoy origin/main;git checkout -b real" 'checkout -b real' \
    "glue '${_glue}' does not open a real checkout segment on a glued decoy (checkout -b real still found)"
  seg_clip "x${_glue}switch -c decoy origin/main;git switch -c real" 'switch -c real' \
    "...same for the switch form (glue '${_glue}')"
done

# CONTROL-BYTE GLUE dimension (review round 3, 2026-09-02 — CRITICAL, security-auditor). The
# boundary alternation's `[[:space:]]` (before this round narrowed to `[[:blank:]]`) is POSIX
# space+tab+newline+VT(0x0B)+FF(0x0C)+CR(0x0D) — but bash's own tokenizer only treats
# space/tab/newline as word-separating. A byte from the other three, glued between an arbitrary
# prefix and `checkout`/`switch`, fuses them into ONE non-existent command word — the same shape
# as `gcheckout`, just a different glue byte (confirmed by running each: `checkout` is never
# invoked, the whole fused token errors as "command not found"). Generated over the dimension the
# vulnerability actually lived on (every byte the class matches that isn't a real bash separator)
# rather than the three bytes a specific review happened to try, so a future widening of this
# class is caught the same way. Mutation-tested: reverting the boundary alternation's
# `[[:blank:]]` back to `[[:space:]]` (its round-2 state) turns every pin in this loop RED with
# the decoy's own content; the current `[[:blank:]]` turns them GREEN.
for _byte in $'\x0b' $'\x0c' $'\x0d'; do
  seg_clip "x${_byte}checkout -b decoy origin/main;git checkout -b real" 'checkout -b real' \
    "control byte glue does not open a real checkout segment on a glued decoy (checkout -b real still found)"
  seg_clip "x${_byte}switch -c decoy origin/main;git switch -c real" 'switch -c real' \
    "...same for the switch form"
done

# PARAMETER-EXPANSION glue is a DOCUMENTED RESIDUAL, not a detection this suite claims (review
# round 2 found the miss as CRITICAL; a same-day neutralization attempt to close it was reverted
# after round 3 found it created a WORSE bug — see the KNOWN RESIDUALS comment at
# cmd_git_branch_create_segment's definition, items 3-4, for the full account). `${x}checkout` (a
# real, live invocation when `x` is unset/empty) is MISSED — the safe-fail direction, matching
# this whole check's own documented fail-open design — rather than risk a repeat of item 4's
# false-decoy shadowing. These pins lock in the SAFE-MISS behavior itself, and the two exact
# constructs round 3 found dangerous, so a future re-attempt at closing item 3 can be checked
# against them before it ships:
det cmd_is_git_branch_create 'git ${x}checkout -b real' no \
  "KNOWN RESIDUAL (accepted, safe-fail): a \${x}-glued real checkout is MISSED, not falsely detected"
seg_clip 'git checkout main; git ${#x}checkout -b fake origin/other ; git checkout -b real' 'checkout -b real' \
  "round-3 regression guard: \${#x} (NEVER empty — always a digit string) must not be treated as a boundary and shadow the real later create (this exact construct was a live CRITICAL in the reverted neutralization pass)"
seg_clip 'git checkout main; git ${a:-${b}}checkout -b fake ; git checkout -b real' 'checkout -b real' \
  "round-3 regression guard: a NESTED \${a:-\${b}}} expansion (confirmed live in real bash) must not shadow the real later create either (a naive single-pass neutralizer cannot balance this and was reverted for it)"
# $(...) command substitution is the one glue mechanism that IS fully, safely handled (no
# neutralization pass needed — see the boundary-whitelist comment on why `)` alone suffices).
# Pinned as a companion so it can't silently regress alongside the \${...} residual above.
det cmd_is_git_branch_create 'git checkout main; git $(true)checkout -b real' yes \
  "companion: a \$(...)-glued real checkout IS detected (unlike \${...}, needs no extra pass)"
seg_clip 'git $(true)checkout -b real origin/main' 'checkout -b real origin/main' \
  "...segment content is unaffected by the command-substitution glue"

echo "--- residuals pinned AT THE LAYER THAT OWNS THEM ---"
# Pinned HERE, at the rendering that OWNS the residual, so it fails if cmd_words
# ever starts unescaping. When this pin was added the guard-level twin was
# over-determined — the fast path globbed raw text, so it produced the same ALLOW
# for a second, unrelated reason — but that mechanism died when the fast path
# moved to a quote-stripped rendering later in this branch. Both discriminate
# now; keeping this one is still right, because one deciding mechanism beats two.
render cmd_words 'e\as update' absent 'eas update' \
  "RESIDUAL: an unquoted backslash hides the escaped char (e\\as stays split)"
# An escaped char must never render as WHITESPACE. `\ ` is an escaped space: the
# shell JOINS on it, so `--body "ship it"\ --auto` is ONE argv word and gh never
# receives an --auto flag. Rendering spaces there SPLIT what the shell joined and
# manufactured a standalone `--auto` token, which GRANTED the immediate-merge
# carve-out. Showing more tokens than argv holds is fatal for a grant-shaped check.
render cmd_words 'gh pr merge 42 --body "a"\ --auto' absent ' --auto' \
  "an escaped space JOINS: --auto never becomes a standalone token"
# A line continuation is the one escape the shell REMOVES entirely, so it must
# emit nothing and let the surrounding space do the separating.
render cmd_words 'eas \
update --branch preview' present 'eas update' \
  "a line continuation collapses onto one line so the verb still matches"

echo "--- ANSI-C \$'...' quoting: the sigil, and \\' as a LITERAL ---"
# Bash strips the `$` sigil from $'…'/$"…". Keeping it left the verb as `$eas`,
# which no command-position anchor matches — a silent ALLOW on every gate.
render cmd_words "\$'eas' update" present 'eas update' \
  "cmd_words drops the \$ sigil before a quote"
render cmd_words '$"gh" pr create' present 'gh pr create' \
  "...for the \$\"...\" locale form too"
render cmd_words 'echo $HOME' present '$HOME' \
  "a bare \$ (not before a quote) is untouched"
det cmd_is_gh_pr_create "\$'gh' pr create --fill" yes "ANSI-C-quoted verb is detected"
# Inside $'…' a backslash ESCAPES the next char, so \' is a literal apostrophe and
# does NOT close the span. Treating it as a closer ended the span early and let the
# trailing quote re-open one that swallowed the REST OF THE COMMAND — a one-token
# prefix hid every deny family in this lib and its consumers.
det cmd_is_git_commit "echo \$'it\\'s ok'; git commit -m x" yes \
  "a \\' inside \$'...' does not swallow the rest of the command"
det cmd_is_gh_pr_create "echo \$'it\\'s ok'; gh pr create --fill" yes \
  "...same for the PR-create gate"
render cmd_bare "echo \$'it\\'s ok'; git commit" present '; git commit' \
  "cmd_bare closes the ANSI-C span correctly too"

echo "--- an EMPTY quoted span is still one argv word ---"
# Rendering it as nothing DELETED the word, so the flag before it became the `prev`
# of whatever followed: `--body "" --auto` read as `--body --auto`, and the
# value-flag decoy check then withheld a carve-out it should have granted.
render cmd_words 'gh pr merge 42 --body "" --auto' present '--body x --auto' \
  "an empty double-quoted span survives as one token"
render cmd_words "gh pr merge 42 --body '' --auto" present '--body x --auto' \
  "an empty single-quoted span survives as one token"

echo "--- ...but a MID-WORD empty span must vanish, not split the word ---"
# The STANDALONE case above is flanked by separators on both sides, so the
# placeholder is what stops the argument disappearing. A MID-WORD empty span
# (flanked by literal word characters, not separators) is a DIFFERENT shape:
# real bash deletes the quote and concatenates straight through it
# (`eas u''pdate` -> `update`, `sh -c "printf '%s\n' eas u''pdate"` proves it).
# The closing-quote check could not tell the two shapes apart — it only asked
# "did the span emit anything", true for BOTH — so it inserted the placeholder
# here too, rendering `eas uxpdate ...` and splitting the verb the
# `eas[[:space:]]+update` deny pattern anchors on: a silent ALLOW of a real OTA
# publish (review, 2026-08-16). Same bug in all three quote states.
render cmd_words "eas u''pdate --branch preview --platform all" present 'eas update' \
  "MID-WORD empty single-quoted span vanishes (not eas uxpdate)"
render cmd_words 'eas u""pdate --branch preview --platform all' present 'eas update' \
  "...same for a MID-WORD empty double-quoted span"
render cmd_words "eas u\$''pdate --branch preview --platform all" present 'eas update' \
  "...same for a MID-WORD empty ANSI-C \$'...' span"
det cmd_is_gh_pr_create "gh pr cre''ate --fill" yes \
  "cmd_is_gh_pr_create still detects create split by a mid-word empty span"
det cmd_is_git_commit "npm pub''lish; git com''mit -m x" yes \
  "cmd_is_git_commit unaffected by an unrelated mid-word empty span earlier in the line"

echo "--- the two renderings must not silently drift ---"
# They differ in exactly three places, all quote/escape handling. On input with
# no quote and no backslash they must be byte-identical; a divergence here means
# one was edited without the other.
DRIFT=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  a=$(printf '%s' "$line" | cmd_bare)
  b=$(printf '%s' "$line" | cmd_words)
  [ "$a" = "$b" ] || { DRIFT=$((DRIFT+1)); echo "  drift on [$line]: bare=[$a] words=[$b]"; }
done <<'CORPUS'
git commit -m x
gh pr create --fill
eas update --branch preview --platform all
npm run test && echo done
ls -la | grep foo; echo hi
git log --oneline -5
FOO=bar git commit
railway up
gh api repos/x/y
npm publish
CORPUS
if [ "$DRIFT" -eq 0 ]; then
  echo "PASS: cmd_bare and cmd_words agree byte-for-byte on quote-free input"; PASS=$((PASS+1))
else
  echo "FAIL: $DRIFT quote-free inputs render differently — the two scans have drifted"; FAIL=$((FAIL+1))
fi

echo "--- git GLOBAL options between \`git\` and its subcommand (_CMD_GIT_GLOBALS) ---"
# Until 2026-09-01 the matchers modelled exactly ONE global, `-c key=value`. Every other
# spelling reported "not a git commit" for a real one — measured, all four predicates. The
# `-C` case mattered most: it is what CLAUDE.md prescribes for worktree sessions, so the
# COMMON form was the invisible one. Generated from dimensions rather than listed, because a
# hand-listed corpus reproduces the author's blind spot (that is how the `&>` family was
# missed for three review rounds).
for _g in '-c user.name=x' '-C /tmp' '--no-pager' '-p' '--literal-pathspecs' \
          '--git-dir=/tmp/x' '--work-tree /tmp' '-C /tmp -C /var' '-C/tmp' '-c a=b -C /tmp'; do
  det cmd_is_git_commit        "git ${_g} commit -m x"      yes "globals: 'git ${_g} commit' is a commit"
  det cmd_is_git_commit_or_push "git ${_g} push"            yes "globals: 'git ${_g} push' is a push"
  det cmd_is_git_head_mover    "git ${_g} rebase main"      yes "globals: 'git ${_g} rebase' moves HEAD"
  det cmd_is_git_branch_create "git ${_g} checkout -b foo"  yes "globals: 'git ${_g} checkout -b' creates"
  det cmd_is_git_branch_create "git ${_g} switch -c foo"    yes "globals: 'git ${_g} switch -c' creates"
done
# ...and a redirect in either pre-command slot, the other half of the same anchor fix.
for _r in '2>/dev/null' '&>/dev/null' '>|log' '2>&1' '</dev/null'; do
  det cmd_is_git_commit        "${_r} git commit -m x"      yes "redirect before the command word (${_r})"
  det cmd_is_git_commit        "git ${_r} commit -m x"      yes "redirect before the subcommand (${_r})"
  det cmd_is_git_head_mover    "${_r} git reset --hard"     yes "redirect before the command word, HEAD mover (${_r})"
done
det cmd_is_git_commit 'git>log commit -m x' yes "an ATTACHED redirect (no space after \`git\`) is still a commit"
# A redirect's TARGET is mandatory in bash. Modelling it as optional let `>` match nothing and
# hand the NEXT word back as the command word: `true && > git commit` creates a FILE named
# `git` and runs `commit` (argv shim), yet was read as a real commit — a false DENY here and,
# worse, a baseline STAMP in drift-detect-update, which absorbs a genuine external drift.
det cmd_is_git_commit 'true && > git commit'  no  "an empty redirect target is not a redirect"
det cmd_is_git_commit 'git > commit'          no  "...nor when it would swallow the subcommand"
det cmd_is_git_commit '2>/dev/null git commit -m x' yes "control: a REAL redirect before the command word still matches"
# A verb GLUED to a redirect needs `<`/`>` in _CMD_POS_SUFFIX; `&>` passed only because `&`
# was already a closer, which is why this slot survived the &> fix one branch down.
for _r in '>&2' '>|log' '>/dev/null' '&>/dev/null' '&>>log'; do
  det cmd_is_git_branch_create "git checkout${_r} -b foo" yes "glued to the SUBCOMMAND (${_r})"
done
det cmd_is_git_commit 'git commit>log'        yes "a verb glued to a redirect is still an invocation"
# _CMD_POS_PREFIX is SHARED with cmd_is_gh_pr_create, so widening it for redirects widens
# that gate too and pr-preflight-guard.sh newly denies this. Correct hardening and the safe
# direction, but a real behaviour change outside the git matchers — pinned so it is a
# decision on the record rather than a side effect nobody wrote down.
det cmd_is_gh_pr_create '2>/dev/null gh pr create --fill' yes "a redirect before the command word no longer hides gh pr create"
det cmd_is_gh_pr_create 'echo "2>/dev/null gh pr create"' no  "...and a quoted mention of that form still does not match"

# NEGATIVE side. Widening a matcher can only ADD matches, so these are the pins that keep
# the widening from becoming a mention-matcher.
det cmd_is_git_commit 'echo "git -C /tmp commit -m x"' no  "a QUOTED mention with globals still does not match"
det cmd_is_git_commit 'echo git -C /tmp commit'        no  "git as an ARGUMENT to echo still does not match"
det cmd_is_git_commit 'echo 2>/dev/null git commit'    no  "...nor when the redirect belongs to the other command"
det cmd_is_git_commit 'git log --grep commit'          no  "a post-verb flag VALUE named commit is not a commit"
det cmd_is_git_commit 'git diff -- commit'             no  "a pathspec named commit is not a commit"
det cmd_is_git_commit 'git config commit.gpgsign false' no "config on a commit.* key is not a commit"
# DOCUMENTED RESIDUAL, inherited from git-safety.sh's identical grammar: an unmodeled
# SEPARATE-arg global has its argument mis-read as the verb. A false NEGATIVE, never a false
# positive. Pinned so the direction is visible, not so the behaviour is blessed.
det cmd_is_git_commit 'git --namespace foo commit'     no  "residual: an unmodeled separate-arg global loses the match"

echo "--- cmd_git_repo_dir: WHICH repository the matched invocations act on ---"
# repo <command> <verbs-constant-value> <expected|SKIP> <label>
repo() {
  local cmd="$1" verbs="$2" want="$3" label="$4" got
  got=$(cmd_git_repo_dir "$cmd" "$verbs") || got=SKIP
  if [ "$got" = "$want" ]; then echo "PASS: $label"; PASS=$((PASS+1))
  else echo "FAIL: $label (got [$got], want [$want])"; FAIL=$((FAIL+1)); fi
}
repo 'git commit -m x'                 "$_CMD_GIT_VERBS_COMMIT" '.'     "no globals at all -> cwd"
repo "git -C /tmp commit -m x"         "$_CMD_GIT_VERBS_COMMIT" '/tmp'  "a single absolute -C resolves"
repo "git -C /tmp commit; git -C /tmp commit -m z" "$_CMD_GIT_VERBS_COMMIT" '/tmp' \
  "two invocations naming the SAME directory resolve"
repo "git -C /tmp commit; git -C /var commit" "$_CMD_GIT_VERBS_COMMIT" SKIP \
  "two invocations naming DIFFERENT directories cannot be resolved"
# THE deny-preserving rule. `git -C /wt commit && git commit` really does commit in cwd, and
# today's gate denies on it; resolving the command to /wt would turn that into an ALLOW — a
# deny->allow transition in a data-loss gate. One unredirected invocation settles it as cwd.
repo "git -C /tmp commit && git commit -m y" "$_CMD_GIT_VERBS_COMMIT" '.' \
  "an UNREDIRECTED invocation in the same command wins -> cwd (preserves today's denies)"
repo "git commit -m y && git -C /tmp commit" "$_CMD_GIT_VERBS_COMMIT" '.' \
  "...in either order"
# THE false-deny rule, the mirror of the one above: the verb set is scoped to the CALLER's
# predicate, so an unrelated `git status` must not vote cwd for a commit-shaped gate.
repo "git -C /tmp commit && git status" "$_CMD_GIT_VERBS_COMMIT" '/tmp' \
  "an unredirected invocation of an UNRELATED verb does not vote"
repo "git -C /tmp status && git commit -m x" "$_CMD_GIT_VERBS_COMMIT" '.' \
  "...and a redirected unrelated verb does not resolve the answer either"
# `-C` AFTER the verb is `git commit -C <commit>` (reuse that commit's message) — a totally
# different flag. Mining it would send the gate to a directory named `HEAD` and, worse, make
# a plain cwd commit unresolvable -> skipped -> a deny->allow regression.
repo 'git commit -C HEAD'              "$_CMD_GIT_VERBS_COMMIT" '.'  "a POST-verb -C (message reuse) is not a repo redirect"
repo 'git commit --reuse-message=HEAD' "$_CMD_GIT_VERBS_COMMIT" '.'  "...nor its long form"
# Unresolvable forms: each falls back to SKIP, which is the pre-2026-09-01 behaviour (blind),
# never a new judgement against the wrong repo.
repo 'git -C ../rel commit'            "$_CMD_GIT_VERBS_COMMIT" SKIP "a RELATIVE -C resolves against the shell's cwd, not the hook's"
repo 'git -C "$WORKTREE" commit'       "$_CMD_GIT_VERBS_COMMIT" SKIP "an unexpanded \$VAR path is unknowable here"
repo 'git -C /tmp/`pwd` commit'        "$_CMD_GIT_VERBS_COMMIT" SKIP "...as is a command substitution"
repo 'git -C/tmp commit'               "$_CMD_GIT_VERBS_COMMIT" SKIP "the glued -C/path form (real git exits 129) does not resolve"
repo 'git --git-dir=/x commit'         "$_CMD_GIT_VERBS_COMMIT" SKIP "--git-dir moves only the git-dir, not the work-tree"
repo 'git --work-tree /x commit'       "$_CMD_GIT_VERBS_COMMIT" SKIP "--work-tree likewise"
# ...but an ENV-form redirect ALONE resolves to cwd, and that is not a shortcut: the inline
# assignment is swallowed by _CMD_POS_PREFIX's env absorber, which predates all of this, so
# `GIT_DIR=.git git commit` DID match and DID deny on main. Answering SKIP here dropped that
# deny — a CRITICAL, measured base=DENY head=ALLOW on a detached HEAD (review 2026-09-01).
repo 'GIT_DIR=/x git commit'           "$_CMD_GIT_VERBS_COMMIT" '.'  "an inline GIT_DIR= alone keeps judging cwd (the old gate's deny)"
repo 'GIT_WORK_TREE=/x git commit'     "$_CMD_GIT_VERBS_COMMIT" '.'  "...same for GIT_WORK_TREE="
# The text `GIT_DIR=` as a `-c` VALUE is not a redirect at all — scanning for it there cost
# the same CRITICAL a second instance, on a command with no repo redirect whatsoever.
repo 'git -c GIT_DIR=x commit'         "$_CMD_GIT_VERBS_COMMIT" '.'  "GIT_DIR= as a -c VALUE is not a repo redirect"
repo 'git -c GIT_WORK_TREE=x commit'   "$_CMD_GIT_VERBS_COMMIT" '.'  "...nor GIT_WORK_TREE= as a -c value"
# ( ) { } ARE NOT CONTROL OPERATORS — they are ordinary content in an unquoted global's
# value, and splitting on them severed `git` from its verb. One real commit, no segment
# matched, every consumer skipped: 144 base-DENY -> new-ALLOW rows over a 6400-input corpus,
# in the data-loss gate (CRITICAL, security review 2026-09-01). An argv shim confirmed the
# first is a single invocation: [-c][core.hooksPath=/…/hooks][commit][-m][x].
repo 'git -c core.hooksPath=$(pwd)/hooks commit -m x' "$_CMD_GIT_VERBS_COMMIT" '.' \
  'a $(...) inside a -c value does not split the invocation'
repo 'git -c foo.bar={a} commit -m x'  "$_CMD_GIT_VERBS_COMMIT" '.'  'nor do braces inside a -c value'
repo 'git -c foo.bar=(a) commit -m x'  "$_CMD_GIT_VERBS_COMMIT" '.'  'nor bare parens'
# ...while the four REAL control operators must still split, or the deny-preserving rule
# above cannot see the second invocation at all.
repo 'git -C /tmp commit; git commit'  "$_CMD_GIT_VERBS_COMMIT" '.'  'a real ; still splits (unredirected clause wins)'
repo 'git -C /tmp commit && git commit' "$_CMD_GIT_VERBS_COMMIT" '.' 'a real && still splits'
repo 'git -C /tmp commit | git commit' "$_CMD_GIT_VERBS_COMMIT" '.'  'a real | still splits'
# MIXED spans: a resolvable -C sitting NEXT TO an unresolvable redirect. Found by mutation
# testing — replacing the count-both-sides check with `true` left the whole suite green,
# because every single-redirect case above lands on SKIP for a second reason (no value was
# extracted at all). Only a span that yields a GOOD value AND an unhandled one discriminates,
# and without the check it would resolve to the -C while git actually reads its refs from the
# --git-dir. The generated corpus could not produce these: it varied one global at a time.
# The saw=0 branch: no segment carries a real invocation, so the repo is unknown. The PAIR is
# the point — the first is a deny main only had because its `-c` value class `[^[:space:]]+`
# swallowed the `;` (bash runs `git -c foo=a`, then a command named `b`; nothing commits), the
# second is a real commit whose deny must survive. One without the other proves nothing.
repo 'git -c foo=a;b commit'           "$_CMD_GIT_VERBS_COMMIT" SKIP "a separator inside a -c VALUE leaves no real invocation -> unknown"
repo 'git -c foo=a;git commit'         "$_CMD_GIT_VERBS_COMMIT" '.'  "...but a real commit in the next clause still resolves to cwd"
repo 'git -C /tmp --git-dir=/x commit'   "$_CMD_GIT_VERBS_COMMIT" SKIP "a resolvable -C beside a --git-dir does not resolve"
repo 'git -C /tmp --work-tree /x commit' "$_CMD_GIT_VERBS_COMMIT" SKIP "...nor beside a --work-tree"
repo 'git -C /tmp -C/var commit'         "$_CMD_GIT_VERBS_COMMIT" SKIP "...nor beside a glued -C"
repo 'GIT_DIR=/x git -C /tmp commit'     "$_CMD_GIT_VERBS_COMMIT" SKIP "...nor beside an inline GIT_DIR="
# An unresolvable invocation must POISON the whole answer, not just drop out of the tally.
# Second mutation-testing find: with the `unresolved` flag ignored, every case above still
# returned SKIP anyway — because a single unresolvable span leaves NO value, and zero values
# is already SKIP. The flag only changes the answer when one span is unresolvable and ANOTHER
# yields exactly one clean value, which needs two invocations in one command. Neither the
# single-invocation pins above nor the generated hook corpus varied that.
repo 'git -C /tmp --git-dir=/x commit; git -C /tmp commit' "$_CMD_GIT_VERBS_COMMIT" SKIP \
  "an unresolvable invocation is not silently dropped when a later one does resolve"
# Per-verb-set answers for one command: this is why branch-preflight resolves TWICE.
repo "git -C /tmp checkout -b foo && git commit -m x" "$_CMD_GIT_VERBS_BRANCH"  '/tmp' \
  "one command, branch verbs -> /tmp"
repo "git -C /tmp checkout -b foo && git commit -m x" "$_CMD_GIT_VERBS_COMMIT" '.' \
  "...the SAME command, commit verbs -> cwd"

echo "--- the verb constant passed to cmd_git_repo_dir must match the caller's predicate ---"
# Passing a WIDER set than the predicate uses re-opens the false-DENY pinned above, and the
# two live in different files, so nothing but this check couples them.
PAIR_BAD=0; PAIR_SEEN=0
while IFS='|' read -r _pred _verbs; do
  [ -n "$_pred" ] || continue
  for _h in "$HOOKDIR"/*.sh; do
    case "$(basename "$_h")" in test-*) continue ;; esac
    # The closing quote is part of the needle: without it `$_CMD_GIT_VERBS_COMMIT` is a
    # PREFIX of `$_CMD_GIT_VERBS_COMMIT_PUSH` and drift-detect.sh matched both rows.
    grep -q -- "cmd_git_repo_dir .*\\\$${_verbs}\"" "$_h" || continue
    PAIR_SEEN=$((PAIR_SEEN+1))
    if ! grep -q -- "$_pred " "$_h"; then
      echo "  BAD: $(basename "$_h") passes \$${_verbs} but never calls ${_pred}"
      PAIR_BAD=$((PAIR_BAD+1))
    fi
  done
done <<'PAIRS'
cmd_is_git_commit|_CMD_GIT_VERBS_COMMIT
cmd_is_git_commit_or_push|_CMD_GIT_VERBS_COMMIT_PUSH
cmd_is_git_head_mover|_CMD_GIT_VERBS_HEAD_MOVER
cmd_is_git_branch_create|_CMD_GIT_VERBS_BRANCH
PAIRS
if [ "$PAIR_BAD" -eq 0 ]; then
  echo "PASS: every cmd_git_repo_dir call site uses its own predicate's verb set"; PASS=$((PASS+1))
else
  echo "FAIL: $PAIR_BAD call site(s) resolve the repo with the wrong verb set"; FAIL=$((FAIL+1))
fi
if [ "$PAIR_SEEN" -ge 4 ]; then
  echo "PASS: control — found $PAIR_SEEN paired call sites to check"; PASS=$((PASS+1))
else
  echo "FAIL: control — only $PAIR_SEEN paired call sites found; the scan is vacuous"; FAIL=$((FAIL+1))
fi
# ...and the constants must still describe what their predicates actually match, or the
# pairing above couples two things that have drifted apart.
for _v in commit push rebase reset pull merge cherry-pick; do
  det cmd_is_git_head_mover "git ${_v} x" yes "constant check: ${_v} is in _CMD_GIT_VERBS_HEAD_MOVER"
done
det cmd_is_git_head_mover     'git status'  no  "constant check: status is NOT a HEAD mover"
det cmd_is_git_commit_or_push 'git rebase main' no "constant check: rebase is NOT in _CMD_GIT_VERBS_COMMIT_PUSH"
det cmd_is_git_commit         'git push'    no  "constant check: push is NOT in _CMD_GIT_VERBS_COMMIT"

echo "--- lib/fastpath-filter.sh: cmd_fastpath_has is genuinely two-stage (executed, not textual) ---"
# shellcheck source=/dev/null
. "$FPLIB" || { echo "FAIL: lib/fastpath-filter.sh is not sourceable"; FAIL=$((FAIL+1)); }
declare -F cmd_fastpath_has >/dev/null || { echo "FAIL: cmd_fastpath_has is not defined by lib/fastpath-filter.sh"; FAIL=$((FAIL+1)); }

# fp_probe <label> <cmd> <want:yes|no> <pattern...> — calls the REAL cmd_fastpath_has (never a
# re-implementation) with the SAME pattern arguments the named hook's own source passes it. Each
# "yes" case is a quote/backslash/newline/$-DISGUISED command that a raw single-stage filter
# would MISS (no literal needle substring present) — this is the executed replacement for the
# old textual "grep for _T=${CMD//" scan: it runs the real two-stage logic on a real bypass
# attempt instead of pattern-matching the source text that implements it.
fp_probe() {
  local label="$1" cmd="$2" want="$3"; shift 3
  local got=no
  cmd_fastpath_has "$cmd" "$@" && got=yes
  if [ "$got" = "$want" ]; then
    echo "PASS: $label"; PASS=$((PASS+1))
  else
    echo "FAIL: $label (got=$got want=$want cmd=[$cmd])"; FAIL=$((FAIL+1))
  fi
}

fp_probe "branch-preflight: quoted commit bypasses raw glob"   'git com"mit" -m x'     yes '*commit*' '*checkout*' '*switch*'
fp_probe "branch-preflight: quoted checkout bypasses raw glob" 'git check"out" -b x'   yes '*commit*' '*checkout*' '*switch*'
fp_probe "branch-preflight: quoted switch bypasses raw glob"   'git swit"ch" main'     yes '*commit*' '*checkout*' '*switch*'
fp_probe "branch-preflight: unrelated command stays out"       'ls -la'                no  '*commit*' '*checkout*' '*switch*'
fp_probe "commit-verify: quoted commit bypasses raw glob"      'git com"mit" -m x'     yes '*commit*'
fp_probe "commit-verify: unrelated command stays out"          'git status'            no  '*commit*'
fp_probe "core-bare-guard: quoted git bypasses raw glob"       'g"i"t status'          yes '*git*'
fp_probe "core-bare-guard: unrelated command stays out"        'npm test'              no  '*git*'
fp_probe "drift-detect: quoted git bypasses raw glob"          'g"i"t push'            yes '*git*'
fp_probe "drift-detect-update: quoted git bypasses raw glob"   'g"i"t commit -m x'     yes '*git*'
fp_probe "guard-outward-cli: quoted eas bypasses raw glob"     'e"a"s update'          yes '*eas*' '*railway*' '*npm*' '*yarn*' '*gh*'
fp_probe "guard-outward-cli: quoted gh bypasses raw glob"      'g"h" pr merge 1'       yes '*eas*' '*railway*' '*npm*' '*yarn*' '*gh*'
fp_probe "guard-outward-cli: unrelated command stays out"      'git status'            no  '*eas*' '*railway*' '*npm*' '*yarn*' '*gh*'
fp_probe "pr-preflight-guard: quoted gh-pr-create (ordered)"   'g"h" pr create --fill' yes '*gh*pr*create*'
fp_probe "pr-preflight-guard: gh present, not pr-create"       'gh issue create'       no  '*gh*pr*create*'
fp_probe "pr-preflight-guard: unrelated command stays out"     'ls -la'                no  '*gh*pr*create*'

echo "--- mutation check: stage 2 is load-bearing, not passing for free ---"
# A reimplementation kept INSIDE a subshell — never sourced into this process — so the
# mutant's definition of cmd_fastpath_has cannot leak into any assertion after this block (a
# mutation probe that redefines the function under test in the test's own shell would silently
# poison everything that runs afterward).
(
  cmd_fastpath_has() {
    local _m_cmd="$1"; shift
    local _m_pat
    for _m_pat in "$@"; do
      case "$_m_cmd" in $_m_pat) return 0 ;; esac
    done
    return 1   # stage 2 (quote/backslash/newline/$ strip + retest) removed on purpose
  }
  cmd_fastpath_has 'git com"mit" -m x' '*commit*' '*checkout*' '*switch*' && exit 1
  cmd_fastpath_has 'git check"out" -b x' '*commit*' '*checkout*' '*switch*' && exit 1
  cmd_fastpath_has 'g"i"t status' '*git*' && exit 1
  cmd_fastpath_has 'e"a"s update' '*eas*' '*railway*' '*npm*' '*yarn*' '*gh*' && exit 1
  cmd_fastpath_has 'g"h" pr create --fill' '*gh*pr*create*' && exit 1
  exit 0
)
if [ "$?" -eq 0 ]; then
  echo "PASS: mutation check — every quoted-bypass probe goes RED without stage 2"; PASS=$((PASS+1))
else
  echo "FAIL: mutation check — a quoted-bypass probe still passes with stage 2 removed (the corpus above does not reach it)"
  FAIL=$((FAIL+1))
fi
# Restore sanity: the REAL cmd_fastpath_has (sourced into THIS shell, untouched by the
# subshell mutant above, which cannot affect its parent's function table) must still pass.
if cmd_fastpath_has 'git com"mit" -m x' '*commit*'; then
  echo "PASS: mutation check — real cmd_fastpath_has still passes after the subshell mutant"; PASS=$((PASS+1))
else
  echo "FAIL: mutation check — real cmd_fastpath_has broken (or leaked-into) after the mutation check"
  FAIL=$((FAIL+1))
fi

echo "--- wiring: each target hook's cmd_fastpath_has call site matches what was just probed ---"
# The probes above call the shared function directly with a HARDCODED pattern set — this
# closes the loop by confirming that pattern set is what the hook's own source ACTUALLY
# passes, not a hand-copied duplicate that could drift from it (the class of bug this whole
# extraction exists to prevent, now one level up: a drifted TEST is as bad as a drifted hook).
assert_wired() {
  local hook="$1" expect="$2" line
  line=$(grep -o 'cmd_fastpath_has "\$CMD"[^|;&]*' "$HOOKDIR/$hook" | head -1)
  if [ -z "$line" ]; then
    echo "FAIL: $hook does not call cmd_fastpath_has"; FAIL=$((FAIL+1)); return
  fi
  case "$line" in
    *"$expect"*) echo "PASS: $hook wired with the probed pattern set"; PASS=$((PASS+1)) ;;
    *) echo "FAIL: $hook's cmd_fastpath_has call ($line) diverged from the probed pattern set ($expect) — update this test's fp_probe/assert_wired calls to match"; FAIL=$((FAIL+1)) ;;
  esac
}
assert_wired branch-preflight.sh    "'*commit*' '*checkout*' '*switch*'"
assert_wired commit-verify.sh       "'*commit*'"
assert_wired core-bare-guard.sh     "'*git*'"
assert_wired drift-detect.sh        "'*git*'"
assert_wired drift-detect-update.sh "'*git*'"
assert_wired guard-outward-cli.sh   "'*eas*' '*railway*' '*npm*' '*yarn*' '*gh*'"
assert_wired pr-preflight-guard.sh  "'*gh*pr*create*'"

# Non-vacuity control: exactly the 7 target hooks must call cmd_fastpath_has — neither fewer
# (a hook silently reverted to an inline copy) nor more (a wiring assertion above is now
# missing for a new caller).
WIRED_COUNT=$(grep -l 'cmd_fastpath_has "\$CMD"' "$HOOKDIR"/*.sh 2>/dev/null | grep -vc '/test-')
if [ "${WIRED_COUNT:-0}" -eq 7 ]; then
  echo "PASS: control — exactly 7 hooks call cmd_fastpath_has"; PASS=$((PASS+1))
else
  echo "FAIL: control — $WIRED_COUNT hook(s) call cmd_fastpath_has, expected 7"
  FAIL=$((FAIL+1))
fi

echo "--- HERE resolution: every target hook resolves to '.' for a bare-filename (no-slash) invocation (executed via a real subprocess, not textual) ---"
# Security review (2026-09-02) finding: every check above varies the COMMAND fed to a hook,
# never the INVOCATION SHAPE — so a future revert of any hook's fork-free HERE line to the
# naive, unguarded form (`HERE="${BASH_SOURCE[0]%/*}"`, dropping the `case "${BASH_SOURCE[0]}"
# in */*) … *) HERE=. ;; esac` guard) would pass every check above unchanged, while silently
# breaking the one invocation shape that guard exists for: a bare filename with no slash
# (`cd .claude/hooks && bash <hook>.sh`) makes the naive form return the filename UNCHANGED
# (not "."), so `. "$HERE/lib/…"` then fails to find a directory that doesn't exist.
#
# This runs each REAL hook as a real `bash -x` subprocess — cwd = its own directory, invoked
# by bare filename — and asserts the xtrace shows the hook's OWN HERE assignment resolving to
# ".", the correct answer for this invocation shape. `2>&1 >/dev/null` captures xtrace (fd2)
# into the command substitution while discarding the hook's normal JSON output (fd1) — order
# matters: fd2 is duplicated onto fd1's CURRENT target (the substitution) before fd1 is then
# redirected away.
#
# Mutation-verified (manually, during implementation): reverting a hook's HERE line to the
# naive form makes this exact trace read `HERE=<hookname>.sh` instead of `HERE=.`, which the
# grep below does not match — this check goes RED for that mutation.
assert_bare_here() {
  local hook="$1" payload="$2" trace
  # -u the hooks' own documented escape hatches (SKIP_BRANCH_PREFLIGHT, SKIP_PR_PREFLIGHT,
  # ALLOW_OUTWARD_CLI): branch-preflight.sh/pr-preflight-guard.sh exit 0 BEFORE reaching HERE=
  # when theirs is set, so a developer with either exported in their shell profile would get a
  # spurious FAIL from this check, unrelated to any real defect (security review, 2026-09-02) —
  # matching the hermeticity the sibling test-branch-preflight.sh/test-pr-preflight-guard.sh
  # suites already advertise for themselves.
  trace=$(cd "$HOOKDIR" && printf '%s' "$payload" | env -u SKIP_BRANCH_PREFLIGHT -u SKIP_PR_PREFLIGHT -u ALLOW_OUTWARD_CLI bash -x "$hook" 2>&1 >/dev/null)
  # <<< (here-string), not `printf | grep -q` — grep -q is an early-exiting reader (it stops
  # at the first match) and $trace here is a full multi-line -x trace; piped through printf,
  # grep's early exit can SIGPIPE the still-writing printf, and pipefail then reports the
  # WRITER's non-zero status even though the READ already found its match (docs/rules/
  # harness.md: "Early-exiting readers fail OPEN under pipefail" — reproduced here for real on
  # branch-preflight.sh, whose trace is long enough to exceed one pipe write).
  if grep -qE '^\+ HERE=\.$' <<< "$trace"; then
    echo "PASS: $hook resolves HERE=. for a bare-filename (no-slash) invocation"; PASS=$((PASS+1))
  else
    local got all_matches
    all_matches=$(grep -E '^\+ HERE=' <<< "$trace")   # diagnostic only — no pipe, no early-exit reader
    got=${all_matches%%$'\n'*}
    echo "FAIL: $hook did NOT resolve HERE=. for a bare-filename invocation (got: ${got:-<none>})"
    FAIL=$((FAIL+1))
  fi
}
assert_bare_here branch-preflight.sh    '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}'
assert_bare_here commit-verify.sh       '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}'
assert_bare_here core-bare-guard.sh     '{"tool_name":"Bash","tool_input":{"command":"git status"}}'
assert_bare_here drift-detect.sh        '{"tool_name":"Bash","tool_input":{"command":"git push"},"session_id":"'"$TEST_SESSION"'"}'
assert_bare_here drift-detect-update.sh '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"session_id":"'"$TEST_SESSION"'"}'
assert_bare_here guard-outward-cli.sh   '{"tool_name":"Bash","tool_input":{"command":"eas update"}}'
assert_bare_here pr-preflight-guard.sh  '{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill"}}'

echo "--- generic scan: no hook may hand-roll a raw single-stage fast path when its matcher reads cmd_words ---"
# The property the pre-extraction version of this file's final block carried for free ("a NEW
# hook that adds a raw single-stage filter fails here rather than in prod") — restated for a
# world where the correct answer is normally "call cmd_fastpath_has", not "carry your own
# stage 2". A hook is IN SCOPE if it calls a `cmd_is_*` matcher (the predicates that read
# cmd_words and so need quote-tolerant treatment — NOT cmd_bare-backed matchers like
# pr-verify.sh's cmd_gh_pr_write_subcommand/cmd_gh_pr_ref, where a raw glob is already a
# superset because cmd_bare only ever BLANKS characters; that is why pr-verify.sh is correctly
# exempt here, same as before this file's extraction). guard-outward-cli.sh's own matching is
# NOT cmd_is_*-based (it reads $WORDS inline), so it was never in this scan's scope either
# before or after the extraction — it is instead covered by the dedicated fp_probe/assert_wired
# checks above and by its own test-guard-outward-cli.sh (248 assertions).
#
# KNOWN, NAMED EXEMPTION (code review, 2026-09-02): this scan is per-FILE, not per-occurrence —
# `grep -q 'cmd_fastpath_has' "$f"` exempts a whole file the instant it finds ONE call, even if
# that file ALSO hand-rolls the strip independently elsewhere. pr-preflight-guard.sh does
# exactly this: it calls cmd_fastpath_has once for its fast path, but its WORDS_BROKEN and
# lib-unsourceable DEGRADED-PATH branches each carry their own independent `_FB=${CMD//…}`
# quote-strip (pre-existing code, out of this todo's Scope Contract — not touched here). Both
# sites ARE regression-locked, just not by this scan: see test-pr-preflight-guard.sh's "12k.
# $-SIGIL bypass in the broken-awk fallback" assertions. Recorded here, rather than silently
# assumed covered, so a future editor doesn't read "calls the helper" as "no more duplication
# in this file."
FASTPATH_BAD=0
FASTPATH_SEEN=0
for f in "$HOOKDIR"/*.sh; do
  case "$(basename "$f")" in test-*) continue ;; esac
  grep -q 'cmd_is_[a-z_]' "$f" || continue
  FASTPATH_SEEN=$((FASTPATH_SEEN+1))
  if grep -q 'cmd_fastpath_has' "$f"; then
    continue   # reaches the shared, unit-tested-above two-stage helper
  fi
  if grep -q 'case "\$CMD" in \*' "$f"; then
    if ! grep -q '_T=\${CMD//' "$f" && ! grep -q '\${CMD//\[' "$f"; then
      echo "  BAD: $(basename "$f") has an inline raw single-stage filter but its matcher reads cmd_words"
      FASTPATH_BAD=$((FASTPATH_BAD+1))
    fi
  else
    echo "  BAD: $(basename "$f") calls a cmd_is_* matcher with NEITHER cmd_fastpath_has NOR any inline fast path"
    FASTPATH_BAD=$((FASTPATH_BAD+1))
  fi
done
if [ "$FASTPATH_BAD" -eq 0 ]; then
  echo "PASS: every cmd_is_*-matcher hook reaches it through a quote-tolerant fast path"; PASS=$((PASS+1))
else
  echo "FAIL: $FASTPATH_BAD hook(s) can be bypassed by quoting before their matcher runs"
  FAIL=$((FAIL+1))
fi
if [ "${FASTPATH_SEEN:-0}" -ge 5 ]; then
  echo "PASS: control — found $FASTPATH_SEEN hooks with a cmd_is_* matcher to check"; PASS=$((PASS+1))
else
  echo "FAIL: control — only $FASTPATH_SEEN cmd_is_*-matcher hooks found; the scan is not looking at anything"
  FAIL=$((FAIL+1))
fi

echo "--- cmd_extract_substitutions: \$(...)/backtick command substitution always executes ---"
# docs/solutions/logic-errors/quoted-command-substitution-always-executes-2026-08-17.md
# and todos/P1-2026-08-17-quoted-command-substitution-inert.md — bash
# always EXECUTES $(...)/backtick regardless of the surrounding quotes, but
# cmd_bare/cmd_words (a flat state machine, no stack) blanked the whole span
# uniformly. cmd_extract_substitutions is a separate, genuinely recursive
# (stack-based) mechanism that finds these bodies without touching cmd_bare or
# cmd_words at all.

# extract <command> <expected-substring-present|absent> <needle> <label>
extract() {
  local cmd="$1" mode="$2" needle="$3" label="$4" out
  out=$(printf '%s' "$cmd" | cmd_extract_substitutions)
  if [ "$mode" = present ]; then
    if grep -qF -- "$needle" <<< "$out"; then echo "PASS: $label"; PASS=$((PASS+1))
    else echo "FAIL: $label (expected '$needle' in: $out)"; FAIL=$((FAIL+1)); fi
  else
    if grep -qF -- "$needle" <<< "$out"; then
      echo "FAIL: $label (unexpected '$needle' in: $out)"; FAIL=$((FAIL+1))
    else echo "PASS: $label"; PASS=$((PASS+1)); fi
  fi
}

extract 'echo "$(eas update --branch preview --platform all)"' present \
  'eas update --branch preview --platform all' \
  "double-quoted \$(...) body is extracted (the exact PR #850 repro)"
extract 'echo "`gh pr merge --admin 42`"' present 'gh pr merge --admin 42' \
  "backtick substitution inside double quotes is extracted"
extract "echo '\$(eas update --branch preview --platform all)'" absent 'eas update' \
  "SINGLE-quoted \$(...) is genuinely inert in bash - extracts NOTHING"
extract 'echo $'"'"'$(eas update)'"'"'' absent 'eas update' \
  "ANSI-C \$'...' is genuinely inert - extracts NOTHING (state 3, not state 2)"
extract 'echo "text with (parens) and no subst"' absent 'text' \
  "bare parens in a double-quoted string are NOT mistaken for a substitution opener"
extract 'echo "$(echo "$(gh pr merge --admin 42)")"' present 'gh pr merge --admin 42' \
  "nested \$(...) inside \$(...) inside double quotes - innermost body still reachable"
extract 'gh pr merge 42 -b "$(echo --auto)"' present 'echo --auto' \
  "a decoy's substitution body is extracted onto its OWN line, never glued to the outer command"

# CRITICAL (security review, 2026-09-02): a first version of the state-2
# branch copied state 0's $' dollar-quote-sigil handling, which flipped the
# scanner into ANSI-C state at the sigil EVEN THOUGH a double-quoted span
# was already open -- ANSI-C quoting is a word-START construct in real
# bash, meaningful only where a NEW word begins, never meaningful mid-word
# inside an already-open double quote. That misclassification silently
# made the extractor treat the very next byte as inert, so a live $(...)
# immediately following the sigil (which bash genuinely executes --
# ground-truthed against a real bash below) was never found.
echo "--- real bash ground-truth: sigil bytes print literally, substitution still executes ---"
BASH_GT_1=$(bash -c 'echo "prefix $'"'"'$(echo LIVE-EXECUTED)'"'"' suffix"')
if [ "$BASH_GT_1" = "prefix \$'LIVE-EXECUTED' suffix" ]; then
  echo "PASS: ground-truth - real bash executes \$(...) after a mid-string \$' and keeps the sigil bytes literal"; PASS=$((PASS+1))
else
  echo "FAIL: ground-truth - unexpected real-bash output: [$BASH_GT_1]"; FAIL=$((FAIL+1))
fi

extract 'echo "prefix $'"'"'$(echo LIVE-EXECUTED)'"'"' suffix"' present 'echo LIVE-EXECUTED' \
  "CRITICAL fix pin: \$' sigil mid-word inside an ALREADY-OPEN double quote does not mask the live \$(...) that follows it"
extract 'echo "prefix $'"'"'$(echo LIVE-EXECUTED)'"'"' suffix"' absent "prefix \$'" \
  "CRITICAL fix pin (two-sided): the sigil bytes are not swallowed into an accumulated substitution body either -- they never opened one"

# WARNING (same review, same branch): a first version also mirrored state
# 0's $" handling into state 2. Unlike $' this does NOT mask a directly
# FOLLOWING substitution (state[d]=2 while already at state 2 is a
# self-transition, mutation-tested below), but it DOES consume the "
# byte as part of the sigil (i++) instead of running it through the real
# DQ-closer branch -- desyncing the scanner's open/closed belief from
# real bash for the remainder of the string. Concretely: a "..."-quoted
# argument that ends in a bare $" swallows what should have been ITS
# closing quote, so the scanner stays in state 2 across a segment
# boundary and reads a SUBSEQUENT, genuinely-single-quoted (inert) body
# as if it were still inside the live double-quote context. Mutation
# verified (2026-09-02): a state-2 $" handler mirroring state 0's exactly
# (state[d]=2 no-op transition + consume the " via i++) makes the FIRST
# assertion below flip from empty to a false-positive extraction of the
# genuinely-inert body; reverting to no-$"-handling (current code)
# restores the correct empty result. This is an over-match (safe
# direction for a deny-shaped check), not a masking under-match like the
# $' CRITICAL -- but it is the same "diverges from the proven cmd_bare/
# cmd_words no-sigil-handling model" defect class, so the fix (deleting
# the branch, not special-casing it) is identical and is pinned here too.
extract 'echo "AAA $"'"'"'$(echo SHOULD-BE-INERT)'"'"'"BBB"' absent 'SHOULD-BE-INERT' \
  "WARNING fix pin: a bare \$\" mid-word does not swallow the real closing quote that follows it -- a genuinely single-quoted (inert) body immediately after is still recognized as inert, not misread as still-open-double-quote-live"

echo "--- cmd_words_deep: the four reproduction cases ---"
# These four are the exact reproduction cases quoted in the todo's Background
# section, verified reproducible on main by piping crafted JSON into the live
# hooks BEFORE this fix (guard-outward-cli.sh / pr-preflight-guard.sh all
# returned ALLOW). test-guard-outward-cli.sh and test-pr-preflight-guard.sh pin
# the same four strings through the actual hook scripts; these pin them at the
# shared-primitive layer. Repros 1-3 (eas update, gh pr merge --admin, gh api
# -X POST) are guard-outward-cli.sh's OWN pattern matchers, not a cmd_is_*
# wrapper, so they are pinned as substring-presence checks on cmd_words_deep's
# own output (what guard-outward-cli.sh's \$WORDS_DEEP actually contains) —
# repro 4 (gh pr create) has a real cmd_is_* wrapper (cmd_is_gh_pr_create),
# used directly by pr-preflight-guard.sh, so that one is pinned as a det().
render_arg cmd_words_deep 'echo "$(eas update --branch preview --platform all)"' present \
  'eas update --branch preview --platform all' \
  "repro 1: eas update hidden in a quoted \$(...) reaches cmd_words_deep's output (guard-outward-cli.sh's own eas pattern reads \$WORDS_DEEP against this same text)"
render_arg cmd_words_deep 'echo "$(gh pr merge --admin 42)"' present \
  'gh pr merge --admin 42' \
  "repro 2: gh pr merge --admin hidden in a quoted \$(...) reaches cmd_words_deep's output"
render_arg cmd_words_deep 'echo "$(gh api -X POST repos/o/r/merges)"' present \
  'gh api -X POST repos/o/r/merges' \
  "repro 3: gh api -X POST hidden in a quoted \$(...) reaches cmd_words_deep's output"
det cmd_is_gh_pr_create 'echo "$(gh pr create --fill)"' yes \
  "repro 4: gh pr create --fill hidden in a quoted \$(...) is now DETECTED (pr-preflight-guard.sh's stamp gate can no longer be skipped this way)"
det cmd_is_gh_pr_create "echo '\$(gh pr create --fill)'" no \
  "control: the SAME text, single-quoted (genuinely inert), stays undetected"

echo "--- cmd_words stays completely UNCHANGED (grant-shaped contract) ---"
# The single most important invariant of this fix: cmd_words_deep is an
# ADDITIONAL function, never a modification to cmd_words itself, because
# guard-outward-cli.sh's \`gh pr merge --auto\` carve-out reads plain \$WORDS to
# GRANT something, not just to add a deny. If cmd_words itself had grown
# substitution-awareness, a decoy \`-b "\$(echo --auto)"\` would manufacture a
# free-standing --auto token INSIDE \$WORDS itself and grant the carve-out to
# an unrelated, immediate 'gh pr merge' - worse than the bug being fixed.
render cmd_words 'gh pr merge 42 -b "$(echo --auto)"' absent ' --auto' \
  "cmd_words (NOT deep) still renders a substitution inside a quoted span as one opaque token - no free-standing --auto"

echo "--- cmd_is_git_head_mover: the ONE consumer where over-matching is unsafe, not just safe-direction ---"
# drift-detect-update.sh writes a HEAD baseline on a match rather than denying,
# so a FALSE match here is suppressive (narrows the drift-detection window),
# not merely over-cautious. The live/inert distinction cmd_extract_substitutions
# already gets right (see the extract() block above) is what protects this
# consumer specifically - pin it at the predicate the consumer actually calls.
det cmd_is_git_head_mover 'echo "$(git reset --hard)"' yes \
  "a head-mover hidden in a LIVE (double-quoted) substitution genuinely executes - baseline SHOULD refresh"
det cmd_is_git_head_mover "echo '\$(git reset --hard)'" no \
  "the SAME text, single-quoted (genuinely inert, never executes) - baseline must NOT spuriously refresh"

echo "--- cmd_words_deep: empty-output invariant survives a broken/absent cmd_extract_substitutions ---"
# guard-outward-cli.sh's and pr-preflight-guard.sh's broken-awk detectors treat
# an all-blank rendering from a non-blank command as "the awk backend failed -
# fail closed via the crude smell test". cmd_words_deep must not defeat that:
# it always calls plain cmd_words FIRST, unconditionally, so a bug or
# unavailability in cmd_extract_substitutions can only cost the ADDED matches,
# never blank the base rendering the existing detector relies on.
DEEP_BASE=$(cmd_words_deep 'git commit -m x')
if [ -n "${DEEP_BASE//[[:space:]]/}" ]; then
  echo "PASS: cmd_words_deep's output is non-blank for a non-blank command (base rendering survives)"; PASS=$((PASS+1))
else
  echo "FAIL: cmd_words_deep returned blank for a non-blank command"; FAIL=$((FAIL+1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
