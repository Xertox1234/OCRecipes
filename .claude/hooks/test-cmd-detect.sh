#!/usr/bin/env bash
# Unit tests for lib/cmd-detect.sh's TWO renderings — run from anywhere.
#
# Pure string predicates: sources the lib and calls its functions on command
# STRINGS. Nothing is ever executed, so no git/gh/eas/railway process runs here.
#
# WHY THIS FILE EXISTS (2026-08-16): the lib had exactly one rendering,
# `cmd_bare`, which BLANKS quoted spans. A real shell word-splits `git "commit"`
# and concatenates `git com"mit"` into the same argv as the bare form, so
# blanking erased the verb before any matcher ran and EVERY command-position
# detector in this lib — and therefore commit-verify, drift-detect,
# pr-preflight-guard, branch-preflight and core-bare-guard — went blind to a
# quoted command word. `cmd_words` is the second rendering that fixes it.
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
         cmd_is_git_commit_or_push cmd_is_git_head_mover; do
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

echo "--- negative controls: bare forms still detected (probe can see anything) ---"
det cmd_is_git_commit   'git commit -m x'      yes "bare git commit still detected"
det cmd_is_gh_pr_create 'gh pr create --fill'  yes "bare gh pr create still detected"

echo "--- negative controls: MENTIONS must stay undetected (no new false denies) ---"
# These are the cases blanking was introduced to protect. cmd_words keeps the
# words, so the COMMAND-POSITION ANCHOR is what has to suppress them — pin it.
det cmd_is_git_commit   'echo "run git commit later"'          no "mention inside echo stays undetected"
det cmd_is_git_commit   'git log --grep "commit"'              no "flag value 'commit' stays undetected"
det cmd_is_gh_pr_create 'git commit -m "then gh pr create"'    no "mention in a commit message stays undetected"
det cmd_is_gh_pr_create 'git commit -m "chore; gh pr create"'  no "SEPARATOR in a commit message does not open a command position"
det cmd_is_git_head_mover 'echo "git reset --hard is bad"'     no "mention of a head-mover stays undetected"
det cmd_is_git_commit   'git commit -m "a" && echo done'       yes "real commit with a quoted arg still detected"

echo "--- residuals pinned AT THE LAYER THAT OWNS THEM ---"
# The guard suite also pins `e\as update` as an ALLOW, but that pin is
# over-determined: two independent mechanisms produce the allow there (this
# rendering, and the necessary-substring fast path). Closing the residual in
# cmd_words alone would leave the guard-level pin green. Pin it here instead,
# where exactly one mechanism decides.
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

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
