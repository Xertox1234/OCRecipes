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

# Necessary-substring fast path for EITHER shape this hook checks. Two-stage: stage 1 is the
# zero-copy glob on raw $CMD; stage 2 (only on a stage-1 miss) retests with the characters
# cmd_words can DELETE removed (quotes, backslashes, newlines, $) — required for any hook whose
# matcher reads cmd_words (see test-cmd-detect.sh's cross-hook fast-path invariant check, and the
# comment on the original commit-only version of this filter for why a single stage is unsound).
_PRE=0
case "$CMD" in *commit*|*checkout*|*switch*) _PRE=1 ;; esac
if [ "$_PRE" = 0 ]; then
  _T=${CMD//\'/}; _T=${_T//\"/}; _T=${_T//\\/}; _T=${_T//$'\n'/}; _T=${_T//\$/}
  case "$_T" in *commit*|*checkout*|*switch*) _PRE=1 ;; esac
fi
[ "$_PRE" = 1 ] || exit 0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_OK=0
# Probe EVERY function the primary path calls, not just the first one. Check 1 now depends on
# cmd_git_repo_dir too, and a lib defining `cmd_is_git_commit` without it set LIB_OK=1, took
# the primary path, got 127 from the `$(…)`, left IS_COMMIT=0 and ALLOWED a plain
# `git commit -m x` on a detached HEAD — the fail-CLOSED promise in this file's header
# quietly bypassed (security review, 2026-09-01; verified against a lib with that one
# function renamed away). Add to this list whenever the primary path grows a dependency.
if . "$HERE/lib/cmd-detect.sh" 2>/dev/null \
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
if [ "$LIB_OK" = 1 ]; then
  if cmd_is_git_commit "$CMD"; then
    REPO_COMMIT=$(cmd_git_repo_dir "$CMD" "$_CMD_GIT_VERBS_COMMIT") && IS_COMMIT=1 || REPO_COMMIT="."
  fi
else
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
  GIT_COMMIT_RE='^[[:space:]]*[`{(!]?[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid)[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
  COMPOUND_COMMIT_RE='(&&|\|\||\||&|;|[`{(!])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid)[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
  if grep -qE "$GIT_COMMIT_RE" <<<"$CMD" || grep -qE "$COMPOUND_COMMIT_RE" <<<"$CMD"; then
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
if [ -z "$REASON" ] && [ "$LIB_OK" = 1 ] && cmd_is_git_branch_create "$CMD" \
   && ! printf '%s' "$CMD" | cmd_words | grep -qE "$_CMD_GIT_REDIRECTS_REPO" \
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
          "$REMOTE" "${MERGE_REF}:refs/remotes/${REMOTE}/${REMOTE_BRANCH}" 2>/dev/null
        BEHIND=$(git rev-list --count "HEAD..@{upstream}" 2>/dev/null || echo "")
        if [ -n "$BEHIND" ] && [ "$BEHIND" -gt 0 ] 2>/dev/null; then
          UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || echo "${REMOTE}/${REMOTE_BRANCH}")
          REASON="Local branch '${BRANCH}' is ${BEHIND} commit(s) behind its upstream (${UPSTREAM}) — branching now risks redoing or duplicating work that already merged there. Run: git fetch ${REMOTE} ${REMOTE_BRANCH} && git merge --ff-only ${UPSTREAM} — then retry. Emergency bypass: SKIP_BRANCH_PREFLIGHT=1."
        fi
      fi
    fi
  fi
fi

[ -n "$REASON" ] || exit 0

jq -n --arg r "$REASON" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": $r
  }
}'
exit 0
