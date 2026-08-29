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
  # Widened 2026-08-29 alongside lib/cmd-detect.sh's _CMD_POS_PREFIX/_CMD_POS_SUFFIX to also
  # catch a brace-grouped, backtick-substituted, or `!`-prefixed real commit (`{ git commit
  # -m x; }`, `` `git commit -m x` ``, `! git commit -m x`) — this fallback previously only
  # recognized start-of-string or &&/||/; before `git commit`, so it silently allowed exactly
  # the shapes the primary-path widening was fixing. NOTE: deliberately does NOT also add `|`
  # (single pipe) — that's a separate, pre-existing gap, unrelated to this widening's scope.
  GIT_COMMIT_RE='^[[:space:]]*[`{!]?[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
  COMPOUND_COMMIT_RE='(&&|\|\||;|[`{!])[[:space:]]*git[[:space:]]+commit([[:space:]]|$)'
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
