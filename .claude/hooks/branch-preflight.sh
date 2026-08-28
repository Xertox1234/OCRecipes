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
if . "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_git_commit >/dev/null; then
  LIB_OK=1
fi

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

REASON=""

# --- Check 1: detached-HEAD commit (unchanged behavior) ------------------------
IS_COMMIT=0
if [ "$LIB_OK" = 1 ]; then
  cmd_is_git_commit "$CMD" && IS_COMMIT=1
else
  # Lib unsourceable → this half of the gate is BLOCKING, so fail CLOSED: keep the raw
  # (quote-unaware) match so a real detached-HEAD commit is still caught. A quoted mention
  # may false-DENY — the accepted cost of never fail-OPENing a data-loss gate.
  GIT_COMMIT_RE='^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
  COMPOUND_COMMIT_RE='(&&|\|\||;)[[:space:]]*git[[:space:]]+commit([[:space:]]|$)'
  if [[ "$CMD" =~ $GIT_COMMIT_RE ]] || printf '%s' "$CMD" | grep -qE "$COMPOUND_COMMIT_RE"; then
    IS_COMMIT=1
  fi
fi

if [ "$IS_COMMIT" = 1 ]; then
  HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [ -z "$BRANCH" ]; then
    REASON="HEAD is detached (at ${HEAD_SHA}) — committing here creates an unreachable commit. Create a named branch first: git switch -c <branch-name>"
  fi
fi

# --- Check 2: branch-create off a stale base (new, 2026-08-28) -----------------
# Only evaluated when check 1 found nothing to deny — see the module comment: exactly one
# decision is emitted per invocation, never two.
if [ -z "$REASON" ] && [ "$LIB_OK" = 1 ] && cmd_is_git_branch_create "$CMD"; then
  BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [ -n "$BRANCH" ]; then
    # Does the command give an explicit start-point beyond the new branch's own name
    # (`git checkout -b foo origin/main`)? If so it isn't relying on local's possibly-stale
    # HEAD — skip. Best-effort word count, not a full arg parser (documented scope gap,
    # matching this lib's existing convention elsewhere): any token after the name that
    # doesn't look like a flag counts as an explicit start-point.
    # Matched text is "checkout -b feature/two ..." (or switch -c ...): token 1 is the
    # subcommand, token 2 the create flag, token 3 the new branch's own required name —
    # skip all three via bash's own word-splitting (collapses whitespace runs correctly,
    # unlike `cut -d' '` on a fixed field number).
    MATCH=$(printf '%s' "$CMD" | cmd_words \
      | grep -oE '(checkout[[:space:]]+-[bB]|switch[[:space:]]+-[cC])[[:space:]]+[^;&|)]*' \
      | head -1)
    HAS_START_POINT=0
    _i=0
    set -f  # MATCH holds ref/branch names verbatim; a literal *,?,[ must not glob against cwd
    for _w in $MATCH; do
      _i=$((_i+1))
      [ "$_i" -le 3 ] && continue  # subcommand, create flag, new branch's own required name
      case "$_w" in
        -*) ;;  # a flag (--track, --quiet, ...) — doesn't itself count as a start-point
        *) HAS_START_POINT=1; break ;;
      esac
    done
    set +f

    if [ "$HAS_START_POINT" = 0 ]; then
      REMOTE=$(git config "branch.${BRANCH}.remote" 2>/dev/null || echo "")
      if [ -n "$REMOTE" ]; then
        # Fetch into the explicit remote-tracking ref — never read FETCH_HEAD (shared across
        # worktrees/processes in this repo; see reference_fetch_head... memory). Bounded
        # against a STALLED transfer (http.lowSpeedLimit/Time); NOT bounded against a dead
        # DNS/TCP handshake — no other hook in this repo bounds a subprocess that way either,
        # and the failure mode (a slow hook on a dead network) is already handled by fail-open.
        git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=5 fetch -q \
          "$REMOTE" "refs/heads/${BRANCH}:refs/remotes/${REMOTE}/${BRANCH}" 2>/dev/null
        BEHIND=$(git rev-list --count "HEAD..@{upstream}" 2>/dev/null || echo "")
        if [ -n "$BEHIND" ] && [ "$BEHIND" -gt 0 ] 2>/dev/null; then
          UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || echo "${REMOTE}/${BRANCH}")
          REASON="Local branch '${BRANCH}' is ${BEHIND} commit(s) behind its upstream (${UPSTREAM}) — branching now risks redoing or duplicating work that already merged there. Run: git fetch ${REMOTE} ${BRANCH} && git merge --ff-only ${UPSTREAM} — then retry. Emergency bypass: SKIP_BRANCH_PREFLIGHT=1."
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
