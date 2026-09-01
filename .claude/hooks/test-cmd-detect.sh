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
# The final block in this file enumerates the fast paths rather than naming them,
# so a NEW hook with a raw single-stage filter fails here instead of in prod.
#
# The two renderings are NOT interchangeable and this file pins both directions:
# merging them re-breaks either flag-presence checks (a quoted `--auto` must not
# GRANT a carve-out) or the loose non-anchored matchers (which have no
# command-position anchor to suppress a mention with).
set -uo pipefail

LIB="$(cd "$(dirname "$0")" && pwd)/lib/cmd-detect.sh"
PASS=0; FAIL=0

# Harness control: a probe that cannot see the thing it tests reports a clean
# bill of health. Prove the lib sourced and the functions exist before asserting.
# shellcheck source=/dev/null
. "$LIB" || { echo "FAIL: lib/cmd-detect.sh is not sourceable"; exit 1; }
for f in cmd_bare cmd_words cmd_is_git_commit cmd_is_gh_pr_create cmd_is_git \
         cmd_is_git_commit_or_push cmd_is_git_head_mover cmd_is_git_branch_create \
         cmd_git_branch_create_segment; do
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
# differential was measuring: every command below really does create a branch, so
# cmd_is_git_branch_create must say yes for all of them, whatever the extraction internals
# become.
#
# The family exists because the first DELETING sed wrote its target word as `[^[:space:]]*`,
# excluding only whitespace — so it also consumed `;`, `&`, `|`, `)` and backtick, which are
# the extractor's own segment boundaries. A redirect ending a clause with NO space before the
# separator deleted the separator, fusing two clauses into one segment; the `case` then
# dispatched on the merged segment's first verb and never searched for the second.
# 240 deny→allow transitions. The verb-MISMATCHED pairs (checkout-then-switch and the
# reverse) are the load-bearing ones — a same-verb pair still finds its create flag by
# accident and would have hidden the bug.
for _redir in '2>/dev/null' '>log' '1>>out' '2>&1' '>|log' '</dev/null'; do
  for _sep in ';' '&&' '||' '|tee x;'; do
    for _pair in 'checkout main|switch -c foo' 'switch main|checkout -b foo'; do
      _first=${_pair%%|*}; _second=${_pair##*|}
      det cmd_is_git_branch_create "git ${_first} ${_redir}${_sep}git ${_second}" yes \
        "corpus: 'git ${_first} ${_redir}${_sep}git ${_second}' still detected (unspaced separator after a redirect must not fuse clauses)"
    done
  done
done
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

echo "--- EVERY hook's necessary-substring fast path must be quote-tolerant ---"
# A hook whose matcher reads cmd_words but whose fast path globs RAW $CMD exits
# before the matcher is ever asked: `git com"mit"` holds no literal `commit`.
# That silently disabled five gates, one of them blocking, while the lib itself
# detected the form. This enumerates the fast paths instead of naming them, so a
# NEW hook that adds a raw single-stage filter fails here rather than in prod.
HOOKDIR="$(cd "$(dirname "$0")" && pwd)"
FASTPATH_BAD=0
for f in "$HOOKDIR"/*.sh; do
  case "$(basename "$f")" in test-*) continue ;; esac
  # The invariant is NOT "every filter strips quotes" — it is "a filter must be a
  # SUPERSET of what its matcher reads". cmd_bare only ever BLANKS characters, so
  # a raw glob is already a superset for a cmd_bare-backed matcher (pr-verify's
  # cmd_gh_pr_write_subcommand / cmd_gh_pr_ref). cmd_words DELETES quote
  # characters and so synthesises needles absent from raw text, so any hook
  # calling a cmd_words-backed `cmd_is_*` matcher needs the stripped second stage.
  if grep -q 'case "\$CMD" in \*' "$f" && grep -q 'cmd_is_[a-z_]' "$f"; then
    if ! grep -q '_T=\${CMD//' "$f" && ! grep -q '\${CMD//\[' "$f"; then
      echo "  BAD: $(basename "$f") globs raw \$CMD but its matcher reads cmd_words"
      FASTPATH_BAD=$((FASTPATH_BAD+1))
    fi
  fi
done
if [ "$FASTPATH_BAD" -eq 0 ]; then
  echo "PASS: every raw-\$CMD fast path has a quote-stripped second stage"; PASS=$((PASS+1))
else
  echo "FAIL: $FASTPATH_BAD hook(s) can be bypassed by quoting before their matcher runs"
  FAIL=$((FAIL+1))
fi
# Control: the scan must actually find fast paths, or it passes vacuously.
FASTPATH_SEEN=$(grep -l 'case "\$CMD" in \*' "$HOOKDIR"/*.sh 2>/dev/null | grep -vc '/test-')
if [ "${FASTPATH_SEEN:-0}" -ge 5 ]; then
  echo "PASS: control — found $FASTPATH_SEEN hooks with a fast path to check"; PASS=$((PASS+1))
else
  echo "FAIL: control — only $FASTPATH_SEEN fast paths found; the scan is not looking at anything"
  FAIL=$((FAIL+1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
