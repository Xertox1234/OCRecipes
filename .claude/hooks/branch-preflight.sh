#!/usr/bin/env bash
# PreToolUse(Bash) — two independent branch-hygiene gates on the same hook:
#   1. Block `git commit` only when HEAD is detached (unreachable commit = silent data loss).
#   2. Block `git checkout -b`/`git switch -c` (the IMPLICIT, from-current-HEAD form only) when
#      the current branch is behind its fetched upstream — prevents branching off stale local
#      state and redoing/duplicating work someone else already merged (2026-08-28 incident:
#      branched off a local `main` one commit stale, re-did an already-merged todo archive,
#      opened a duplicate PR). An EXPLICIT start-point (`git checkout -b foo origin/main`) is
#      deliberately not guarded here — the command isn't relying on local's possibly-stale HEAD.
# A single compound command can match BOTH shapes (`git checkout -b foo && git commit -m x`), so
# both checks run but EXACTLY ONE decision is emitted (check 1 takes priority; see below).
# Asymmetric fail-direction: check 1 protects against irreversible data loss and fails CLOSED
# (raw-regex fallback) when lib/cmd-detect.sh is unsourceable; check 2 is a hygiene nudge, not a
# safety invariant, and fails OPEN (skipped) in that same situation — a broken install shouldn't
# also start blocking branch creation on a network-dependent heuristic.
# Escape: set SKIP_BRANCH_PREFLIGHT=1 in the shell that launched Claude Code.
set -uo pipefail

[ -n "${SKIP_BRANCH_PREFLIGHT:-}" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# From here to the end, the hook's shell must not end without a decision (2026-11-24). A
# PreToolUse hook that ends silently is an ALLOW, so anything that ended this shell early let
# a commit on a detached HEAD through, each measured: a lib that exits when sourced (both were
# sourced in this shell with no probe), a lib function that exits when called here
# (cmd_fastpath_has, cmd_is_git_commit), a lib that shadows jq, declare, git or printf, a
# signal, a final jq that could not print. DECIDED is set only by deny() and allow(). Any
# other end runs no_decision, which denies when the command matches the fallback commit
# regexes below (the ones the lib-less path already uses) and stays silent otherwise, so a
# broken hook does not block ordinary commands. The branch-behind-upstream check is hygiene
# and already fails open with no lib, so the trap does not speak for it. The trap is not
# inherited by `$(...)`. fd 9 is the hook's real stdout: the shell can end inside a command
# whose stdout is redirected, and the trap would inherit that redirect. Not covered: a lib
# that replaces the trap, sets DECIDED, assigns a variable the hook reads, redefines a
# function defined above the libs, defines `builtin`, or closes fd 9; SIGKILL, the fault,
# stop and real-time signals; the exits above this line (docs/harness-residuals.md).
#
# The fallback regexes (used when the lib is unusable, and by the trap). See the comment at
# their use site in Check 1 for what they do and do not model.
GIT_COMMIT_RE='^[[:space:]]*[`{(!]?[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid)[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
COMPOUND_COMMIT_RE='(&&|\|\||\||&|;|[`{(!])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid)[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
exec 9>&1
DECIDED=""
# Named with the hook's prefix: a lib that happened to define `deny` or `allow` would replace
# a plain-named one (the hook's are defined before the libs are sourced).
_bp_allow() { DECIDED=1; exit 0; }
# deny builds its JSON inside `$(...)` first and marks the decision only when the text holds
# the deny; the reason is cut at 8000 characters (one argv entry over 128 KB is E2BIG).
# When jq cannot render it, a static deny is printed instead: the verdict is already known
# here, so it must not be handed back to the trap's text test (which misses some spellings).
_BP_SIGS='TERM INT HUP PIPE ALRM USR1 USR2 QUIT ABRT XCPU XFSZ VTALRM PROF SYS IO'
_bp_ignore_signals() {
  # shellcheck disable=SC2086
  trap '' $_BP_SIGS
  trap '' PWR 2>/dev/null || :
  trap '' STKFLT 2>/dev/null || :
}
_bp_deny() {
  local j r="$1"
  [ "${#r}" -gt 8000 ] && r="${r:0:8000} [... reason cut at 8000 characters]"
  j=$(jq -n --arg r "$r" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": $r
  }
}' 2>/dev/null) || j=""
  _bp_ignore_signals
  DECIDED=1
  case "$j" in
    *'"permissionDecision": "deny"'*) builtin printf '%s\n' "$j" >&9 ;;
    *) builtin printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"branch-preflight: this command is blocked, and the hook could not render its reason (jq failed). The two checks are: a git commit on a detached HEAD (check: git symbolic-ref --short HEAD; fix: git switch -c <branch-name>), and creating a branch while the current one is behind its upstream (fix: git pull --ff-only). Bypass (emergencies only): SKIP_BRANCH_PREFLIGHT=1 in the shell that launched Claude Code."}}' >&9 ;;
  esac
  exit 0
}
# _bp_looks_like_commit: the text test used when the lib cannot answer (the fallback in Check
# 1) and by the trap. The two regexes above model a command position but only the `-c k=v`
# global, so they miss spellings the lib denies: `git --no-pager commit`, `git -C <dir>
# commit`, a redirect before `git`, a quoted `"git"` or `comm""it`, `A="b c" git commit`
# (security review, 2026-11-24, each measured as an allow on these degraded paths). The wide
# test reads the command with quotes and backslashes removed and asks for the word `git`, then
# any number of option words (each may carry one value word), then `commit`. Only options may
# sit between the two: `git status -m commit` is not a commit and stays silent (pinned by the
# lib-missing rows). It can over-match (`git -p status commit` reads `status` as a value),
# which on these paths costs a false deny on a detached HEAD while the lib is broken, never an
# allow. Still missed: a global whose value holds a space (`git -c "a=b c" commit`), and `git`
# reached through a path or a wrapper the lib also misses (docs/harness-residuals.md).
_BP_WIDE_COMMIT_RE='(^|[^A-Za-z0-9_./-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]-][^[:space:]]*)?)*[[:space:]]+commit([^A-Za-z0-9_-]|$)'
_bp_looks_like_commit() {
  grep -qE "$GIT_COMMIT_RE" <<<"$CMD" && return 0
  grep -qE "$COMPOUND_COMMIT_RE" <<<"$CMD" && return 0
  local t; t=$(tr -d "\"'\\\\" <<<"$CMD")
  grep -qE "$_BP_WIDE_COMMIT_RE" <<<"$t"
}
no_decision() {
  [ -n "$DECIDED" ] && return 0
  # Signals are ignored from here: a second one landing while the test below ran saw DECIDED
  # set and left with nothing printed.
  _bp_ignore_signals
  DECIDED=1
  if _bp_looks_like_commit; then
    builtin printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"branch-preflight: the hook ended before it reached a decision (a helper under .claude/hooks/lib/ ended the hook, or the hook was interrupted) on a command that looks like a git commit, so it cannot say HEAD is on a named branch. Fail-closed. Check with: git symbolic-ref --short HEAD. Bypass (emergencies only): SKIP_BRANCH_PREFLIGHT=1 in the shell that launched Claude Code."}}' >&9
  fi
  exit 0
}
trap no_decision EXIT
# A trapped signal would otherwise RETURN to the interrupted command; end the shell instead.
# PWR and STKFLT do not exist in macOS bash, so each is set on its own line that may fail.
# shellcheck disable=SC2086
trap 'no_decision; exit 0' $_BP_SIGS
trap 'no_decision; exit 0' PWR 2>/dev/null || :
trap 'no_decision; exit 0' STKFLT 2>/dev/null || :

# lib_loads <file>: source it in a subshell first. A lib that exits, fails under this file's
# `set -u`, changes the shell options (errexit left on), or leaves a function named like a
# builtin or a command this hook calls counts as missing. TWIN of git-safety.sh's lib_loads
# and _gs_no_shadow. The check runs through `builtin`, so a lib that defines a function called
# `builtin` defeats it (docs/harness-residuals.md).
_BP_NO_SHADOW=(. : '[' break builtin cd command compgen continue declare echo eval exec exit
  export false kill local printf pwd read readonly return set shift shopt source test trap true
  type typeset unset wait cat ls grep jq awk sed tr sort dirname head wc tail git)
_bp_no_shadow() {
  for _bp_f in "${_BP_NO_SHADOW[@]}"; do
    builtin declare -F -- "$_bp_f" >/dev/null 2>&1 && builtin return 1
  done
  builtin return 0
}
lib_loads() {
  [ "$(_o="$-:$SHELLOPTS"; { . "$1"; } >/dev/null 2>&1; _bp_no_shadow && [ "$-:$SHELLOPTS" = "$_o" ] && printf loaded)" = loaded ]
}

# Fork-free: a $(cd ...) subshell here is the ENTIRE added cost of reaching the shared
# fast-path helper below (measured ~1.9ms/call; sourcing itself is free) — this HERE now
# runs on every Bash tool call, not just ones that already matched the old inline filter.
# The */*) arm is load-bearing: a bare "${BASH_SOURCE[0]%/*}" returns the filename unchanged
# when invoked with no slash (e.g. `cd .claude/hooks && bash branch-preflight.sh`), the source
# below then fails, and this hook silently exits before either check ever runs.
case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac

# Necessary-substring fast path for EITHER shape this hook checks, via the shared helper
# (lib/fastpath-filter.sh) — two-stage: stage 1 is the zero-copy glob on raw $CMD; stage 2
# (only on a stage-1 miss) retests with the characters cmd_words can DELETE removed (quotes,
# backslashes, newlines, $) — required for any hook whose matcher reads cmd_words (see
# test-cmd-detect.sh's cross-hook fast-path invariant check). If the helper is unsourceable,
# do NOT exit here — fall through to the LIB_OK determination below, which already has its
# own tested fail-closed/fail-open handling per check; losing the cheap pre-filter only costs
# performance in that (broken-install) case, never a decision.
# Sourced and called INSIDE one `$(...)` (2026-11-24), never in the hook's own shell: sourced
# there, a lib that exits took the hook with it, and so did a cmd_fastpath_has that exits. The
# answer is the function's rc as text; only a clean "1" (no needle) takes the fast way out.
# Empty means the lib exited, left a shell option changed or a shadowing function (the
# lib_loads test, inlined to keep this at ONE fork per Bash call), or the function did not
# return: then the checks below run, as with no filter at all.
_BP_FP_RC=$(_o="$-:$SHELLOPTS"; { . "$HERE/lib/fastpath-filter.sh"; } >/dev/null 2>&1
  _bp_no_shadow && [ "$-:$SHELLOPTS" = "$_o" ] && declare -F cmd_fastpath_has >/dev/null || exit 0
  cmd_fastpath_has "$CMD" '*commit*' '*checkout*' '*switch*' >/dev/null 2>&1; printf '%s' "$?")
[ "$_BP_FP_RC" = 1 ] && _bp_allow

LIB_OK=0
# Probe EVERY function the primary path calls, not just the first one. Check 1 now depends on
# cmd_git_repo_dir too, and a lib defining `cmd_is_git_commit` without it set LIB_OK=1, took
# the primary path, got 127 from the `$(…)`, left IS_COMMIT=0 and ALLOWED a plain
# `git commit -m x` on a detached HEAD — the fail-CLOSED promise in this file's header
# quietly bypassed (security review, 2026-09-01; verified against a lib with that one
# function renamed away). Add to this list whenever the primary path grows a dependency.
# The real source discards stdout as well as stderr (2026-11-24): a lib that prints when
# sourced put its text ahead of the deny JSON, and a reader that wants ONE JSON value reads
# that as no decision. The decisions themselves go to fd 9.
if lib_loads "$HERE/lib/cmd-detect.sh" && . "$HERE/lib/cmd-detect.sh" >/dev/null 2>&1 \
   && declare -F cmd_is_git_commit >/dev/null \
   && declare -F cmd_git_repo_dir >/dev/null; then
  LIB_OK=1
fi

REASON=""

# WHICH REPOSITORY does the command act on? (2026-09-01.) Both checks below read HEAD, the
# branch, and the upstream — until now always from this hook's own cwd, which was correct
# only because `git -C <path>` was invisible to the matchers. Now that it is visible, each
# check must decide its own answer, and they differ: check 1 RESOLVES the repo (read-only,
# and it is the data-loss gate, so it must follow the command), while check 2 is cwd-ONLY and
# simply declines when a global redirect is present — see its own note below. `.` means cwd.
# A resolution
# FAILURE means the command redirects somewhere unresolvable (a `$VAR` path, a relative -C,
# --git-dir) — that check is then SKIPPED, which is exactly its pre-2026-09-01 behaviour on
# such a command, never a new judgement against the wrong repo.
REPO_COMMIT="."

# --- Check 1: detached-HEAD commit (unchanged behavior) ------------------------
IS_COMMIT=0
# cmd_is_git_commit is called inside `$(...)` (2026-11-24): called directly, one that EXITS
# ended the hook with no decision. The answer is its rc as text. Anything but a clean 0 or 1
# (it did not return, or returned something else) is "the lib could not tell", and takes the
# same fail-closed fallback as a lib that is not there.
_BP_FALLBACK=0
if [ "$LIB_OK" = 1 ]; then
  _BP_IS_COMMIT=$(cmd_is_git_commit "$CMD" >/dev/null 2>&1; printf '%s' "$?")
  case "$_BP_IS_COMMIT" in
    0) # rc 0 = the repo dir; rc 1 = a redirect it cannot place (not judged, as before). Any
       # other rc (127 from a missing helper, a signal) is a broken function, not an answer,
       # and takes the fallback. A function that fails with exactly 1 still reads as "cannot
       # place" (docs/harness-residuals.md).
       REPO_COMMIT=$(cmd_git_repo_dir "$CMD" "$_CMD_GIT_VERBS_COMMIT"); _BP_DIR_RC=$?
       case "$_BP_DIR_RC" in
         0) IS_COMMIT=1 ;;
         1) REPO_COMMIT="." ;;
         *) REPO_COMMIT="."; _BP_FALLBACK=1 ;;
       esac ;;
    1) ;;
    *) _BP_FALLBACK=1 ;;
  esac
else
  _BP_FALLBACK=1
fi
if [ "$_BP_FALLBACK" = 1 ]; then
  # Lib unsourceable → this half of the gate is BLOCKING, so fail CLOSED: keep the raw
  # (quote-unaware) match so a real detached-HEAD commit is still caught. A quoted mention
  # may false-DENY — the accepted cost of never fail-OPENing a data-loss gate.
  # Widened 2026-08-29 alongside lib/cmd-detect.sh's _CMD_POS_PREFIX/_CMD_POS_SUFFIX to also
  # catch a brace-grouped, backtick-substituted, or `!`-prefixed real commit (`{ git commit
  # -m x; }`, `` `git commit -m x` ``, `! git commit -m x`) — this fallback previously only
  # recognized start-of-string or &&/||/; before `git commit`, so it silently allowed exactly
  # the shapes the primary-path widening was fixing.
  # Widened again 2026-09-02 (todos/P2-2026-08-29-branch-preflight-fallback-parity-gaps.md) to
  # close the parity gaps that widening's own comment — and
  # docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md's
  # Unresolved section — recorded rather than fixed: a subshell opener `(`; a newline-separated
  # compound (switched the GIT_COMMIT_RE check from `[[ =~ ]]`, which anchors `^`/`$` to the
  # WHOLE string, to `grep -qE` via a herestring, which anchors per LINE — matching how
  # COMPOUND_COMMIT_RE was already checked); a runner-word wrapper
  # (`env`/`command`/`builtin`/`exec`/`nohup`/`setsid`, mirroring lib/cmd-detect.sh's
  # `_CMD_POS_PREFIX`) — applied to BOTH regexes' absorber group, not just GIT_COMMIT_RE's: a
  # first pass only widened GIT_COMMIT_RE's group, missing that a runner word or bare env
  # assignment AFTER a compound separator (`true && env FOO=1 git commit -m x`) still bypassed
  # COMPOUND_COMMIT_RE, which had no absorber group at all — found live by two independent
  # reviewers on this same diff (constructed and denied only after this fix); and a
  # `-c key=value` group on COMPOUND_COMMIT_RE (GIT_COMMIT_RE already had it). Diffing this
  # fallback's separator class against the primary path's `_CMD_POS_PREFIX` character-for-
  # character (this doc's own "Prevention" method), not just the todo's enumerated cases, found
  # the already-tracked bare `|` gap has a twin: bare `&` (`git status & git commit -m oops` — a
  # real backgrounded invocation). Both closed in the same pass, since they're the same
  # one-character widening. Also brought the env-assignment value class in line with the primary
  # path's `[^[:space:]]*` (zero-or-more — `FOO=` with an empty value) instead of the fallback's
  # old `[^[:space:]]+` (one-or-more), the same narrower-than-primary defect shape one character
  # over.
  # IMPORTANT: the GIT_COMMIT_RE/COMPOUND_COMMIT_RE check below uses a herestring
  # (`<<<"$CMD"`), never `printf '%s' "$CMD" | grep -qE ...` — under this script's `pipefail`,
  # an early-matching `grep -q` on the read side of a pipe can make the PIPELINE's reported exit
  # status reflect the writer's SIGPIPE rather than the successful match, silently flipping a
  # real match into a false allow (see
  # docs/solutions/logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md).
  # A herestring has no writer process to race.
  # Still NOT at parity with the primary (lib-sourced) path, and out of this widening's scope:
  # shell-keyword command positions (`if`/`then`, `for`/`do`, `while`/`do`, `case`, etc.) — a gap
  # the primary path's own `_CMD_POS_PREFIX` shares too (see the solution doc's Unresolved
  # section), so this is not a fallback-vs-primary divergence, just a residual both paths carry.
  # Also still missing: redirect absorption (the primary path's `_CMD_REDIR` alternative inside
  # `_CMD_POS_PREFIX` lets a redirect like `2>/dev/null` sit between the anchor and the verb,
  # e.g. `2>/dev/null git commit -m x`) — pre-existing, not a regression from this widening, and
  # out of the todo's Scope Contract (widen the existing character classes, no new mechanism).
  # CORRECTED 2026-09-02 (security-auditor, round-2 review of this same widening —
  # construct-and-run against both this fallback and the pre-widening committed version, not
  # just reading the regex): a prior version of this comment claimed `git -C /elsewhere commit`
  # "can DENY" here, in the safe direction. That was checked and is false in BOTH directions —
  # neither `GIT_COMMIT_RE` nor `COMPOUND_COMMIT_RE` absorbs an uppercase `-C` (only lowercase
  # `-c key=value` is in the group, and that is for git-config overrides, not repo redirection),
  # so the whole match fails and `IS_COMMIT` never becomes 1: `git -C /elsewhere commit -m x` is
  # SILENTLY ALLOWED by this fallback, full stop — pre-existing (confirmed against
  # `git show HEAD:.claude/hooks/branch-preflight.sh` from before this todo's widening started),
  # not a regression from this diff, but the unsafe direction for a fail-closed data-loss gate:
  # the primary (lib-sourced) path follows `-C` and independently checks the TARGET repo's HEAD
  # (see `cmd_git_repo_dir` above), so a real detached-HEAD commit in /elsewhere that the primary
  # path would catch is invisible to this fallback when the lib is unsourceable. `-C`/`-c`-global
  # absorption is a new detection mechanism (following a redirect, not widening a character
  # class), so it is out of this todo's Scope Contract; tracked as a residual for
  # todos/P2-2026-08-29-branch-preflight-fallback-parity-gaps.md's follow-up rather than fixed
  # here.
  if _bp_looks_like_commit; then
    IS_COMMIT=1
  fi
fi

# The `rev-parse --git-dir` probe is per-CHECK, not one global pre-guard as before: with a
# resolved `-C` target the question "is this a repo" is about THAT directory, and it also
# subsumes the existence check cmd_git_repo_dir deliberately does not perform. Without it a
# non-existent path would make every query below return empty and read as a detached HEAD.
if [ "$IS_COMMIT" = 1 ] && git -C "$REPO_COMMIT" rev-parse --git-dir >/dev/null 2>&1; then
  HEAD_SHA=$(git -C "$REPO_COMMIT" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  BRANCH=$(git -C "$REPO_COMMIT" symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [ -z "$BRANCH" ]; then
    WHERE=""
    [ "$REPO_COMMIT" = "." ] || WHERE=" in ${REPO_COMMIT}"
    REASON="HEAD is detached${WHERE} (at ${HEAD_SHA}) — committing here creates an unreachable commit. Create a named branch first: git switch -c <branch-name>"
  fi
fi

# --- Check 2: branch-create off a stale base (new, 2026-08-28) -----------------
# Only evaluated when check 1 found nothing to deny — see the module comment: exactly one
# decision is emitted per invocation, never two.
# CHECK 2 IS CWD-ONLY, BY DECISION (2026-09-01). It briefly followed a resolved `-C` into
# another repository and that was wrong twice over, both found by security review:
#
#   1. WRONG INVOCATION. cmd_git_repo_dir answers for the whole command over
#      `(checkout|switch)`, voting `.` on ANY unredirected checkout — but the start-point
#      extraction below picks the segment carrying a CREATE flag. Those can be different
#      invocations, so `git --no-pager checkout main && git -C /other checkout -b foo` judged
#      cwd's staleness for a create that happens in /other: base ALLOW, new DENY, 96/800 in a
#      co-occurrence corpus. The mirror (`git -C /wt checkout -b foo && git checkout main`)
#      resolved to `.` and left a create off a stale /wt unchecked.
#   2. SIDE EFFECT FROM UNAPPROVED TEXT. This check FETCHES and writes remote-tracking refs.
#      Following `-C` meant a PreToolUse hook mutating a repository named only by a command
#      string that was never approved and may never run — demonstrated by watching
#      `origin/main` move in a repo the command only mentioned.
#
# So: if the command carries a GLOBAL-form repo redirect anywhere, skip. That is exactly the
# pre-2026-09-01 behaviour (the old predicate could not see those globals at all), so nothing
# is lost, and every git call below is cwd's again. The ENV form is deliberately NOT a skip
# trigger — `_CMD_POS_PREFIX` has always absorbed it, so `GIT_DIR=/x git checkout -b foo` was
# judged against cwd before and still is. Check 1 keeps full `-C` resolution: it is read-only
# and it is the gate that prevents data loss.
# cmd_is_git_branch_create is called inside `$(...)` for the same reason as cmd_is_git_commit.
# Only a clean 0 runs this check; anything else skips it, as a missing lib always has (this
# check is hygiene and fails open). The words go to grep as a here-string, never down a pipe:
# under pipefail, grep -q leaving at its first match reads as 141, "no match".
_BP_IS_CREATE=1
if [ -z "$REASON" ] && [ "$LIB_OK" = 1 ]; then
  _BP_IS_CREATE=$(cmd_is_git_branch_create "$CMD" >/dev/null 2>&1; printf '%s' "$?")
fi
if [ "$_BP_IS_CREATE" = 0 ] \
   && ! grep -qE "$_CMD_GIT_REDIRECTS_REPO" <<<"$(printf '%s' "$CMD" | cmd_words)" \
   && git rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [ -n "$BRANCH" ]; then
    # Does the command give an explicit start-point beyond the new branch's own name
    # (`git checkout -b foo origin/main`)? If so it isn't relying on local's possibly-stale
    # HEAD — skip. Best-effort, not a full arg parser (documented scope gap, matching this
    # lib's existing convention elsewhere): locate the create flag by CONTENT, not by a fixed
    # token position — counting a fixed number of tokens to skip silently mis-scanned once
    # another flag (e.g. `-q`) shifted where the branch name actually sits, causing a false
    # "explicit start-point" detection that skipped this check on a command that WAS relying
    # on local's stale HEAD (review, 2026-08-28). Consume the create flag (plus a separate
    # name token, unless the value was attached: `-bfoo`), then anything non-flag remaining
    # counts as an explicit start-point.
    # cmd_git_branch_create_segment (shared with cmd_is_git_branch_create above) — NOT an
    # independent re-scan here: two call sites independently picking "the" segment is exactly
    # how the original bug this comment describes happened, and a second review pass found a
    # second instance of it (an earlier unrelated checkout/switch winning a naive `head -1`).
    SEGMENT=$(cmd_git_branch_create_segment "$CMD")
    HAS_START_POINT=0
    FLAG_FOUND=0
    set -f  # SEGMENT holds ref/branch names verbatim; a literal *,?,[ must not glob against cwd
    set -- $SEGMENT
    set +f
    while [ "$#" -gt 0 ]; do
      if [ "$FLAG_FOUND" = 0 ]; then
        case "$1" in
          -b|-B|-c|-C) FLAG_FOUND=1; shift; shift 2>/dev/null || true; continue ;;
          -b*|-B*|-c*|-C*) FLAG_FOUND=1; shift; continue ;;  # attached value: -bfoo
          *) shift; continue ;;  # the subcommand word, or an unrelated preceding flag
        esac
      fi
      case "$1" in
        -*) ;;  # a flag (--track, --quiet, ...) after the name — doesn't count as a start-point
        *) HAS_START_POINT=1; break ;;
      esac
      shift
    done

    if [ "$HAS_START_POINT" = 0 ]; then
      REMOTE=$(git config "branch.${BRANCH}.remote" 2>/dev/null || echo "")
      # branch.<name>.merge (e.g. "refs/heads/main") names the ACTUAL remote branch this one
      # tracks — do not assume it shares the local branch's own name (review, 2026-08-28: a
      # branch created via `checkout -b wip origin/main` tracks origin/main, not origin/wip,
      # and fetching the wrong-named ref is a silent no-op that misses real drift).
      MERGE_REF=$(git config "branch.${BRANCH}.merge" 2>/dev/null || echo "")
      REMOTE_BRANCH="${MERGE_REF#refs/heads/}"
      if [ -n "$REMOTE" ] && [ -n "$REMOTE_BRANCH" ] && [ "$REMOTE_BRANCH" != "$MERGE_REF" ]; then
        # Fetch into the explicit remote-tracking ref — never read FETCH_HEAD (shared across
        # worktrees/processes in this repo; see reference_fetch_head... memory). Bounded
        # against a STALLED transfer (http.lowSpeedLimit/Time), not a dead DNS/TCP handshake —
        # no other hook in this repo bounds a subprocess that way either. If the surrounding
        # hook-timeout (.claude/settings.json, currently 10s) treats a killed process as deny
        # rather than allow, a dead network could turn this hygiene-only check into an
        # unintended block — unverified either way; accepted for now, worth revisiting if seen.
        git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=5 fetch -q \
          "$REMOTE" "${MERGE_REF}:refs/remotes/${REMOTE}/${REMOTE_BRANCH}" 2>/dev/null 9>&-
        BEHIND=$(git rev-list --count "HEAD..@{upstream}" 2>/dev/null || echo "")
        if [ -n "$BEHIND" ] && [ "$BEHIND" -gt 0 ] 2>/dev/null; then
          UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || echo "${REMOTE}/${REMOTE_BRANCH}")
          REASON="Local branch '${BRANCH}' is ${BEHIND} commit(s) behind its upstream (${UPSTREAM}) — branching now risks redoing or duplicating work that already merged there. Run: git fetch ${REMOTE} ${REMOTE_BRANCH} && git merge --ff-only ${UPSTREAM} as its own command first, then retry: this check runs before any of the command does, so a command that fast-forwards and then branches is still denied. Emergency bypass: SKIP_BRANCH_PREFLIGHT=1."
        fi
      fi
    fi
  fi
fi

[ -n "$REASON" ] || _bp_allow

_bp_deny "$REASON"
