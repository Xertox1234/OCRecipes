#!/usr/bin/env bash
# PreToolUse — hard-block PR creation (Bash `gh pr create` OR the
# mcp__github__create_pull_request tool) unless a fresh pass-stamp exists for the current HEAD.
# Any HEAD-matching stamp is accepted: the pre-push fast gate writes one (type-aware lint + tsc
# + related tests) and `npm run preflight` writes one for full local parity. COVERAGE is
# enforced by CI's required checks, not here. The /todo executor flow has no PR at push time AND
# creates via the MCP tool, so the pre-push hook cannot gate it — this does (both PR-creation
# paths converge here).
# Escape (emergencies): set SKIP_PR_PREFLIGHT=1 in the shell that launched Claude Code.
set -uo pipefail

[ -n "${SKIP_PR_PREFLIGHT:-}" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0

# From here to the end, the hook's shell must not end without a decision (2026-11-25). A
# PreToolUse hook that ends silently is an ALLOW, so anything that ended this shell early let
# a PR be created with no pass-stamp, each measured: a lib under .claude/hooks/lib/ or
# scripts/lib/ that exits when sourced (all four were sourced in this shell with no probe), a
# lib function that exits when called here (cmd_fastpath_has, cmd_is_gh_pr_create,
# preflight_stamp_has), a lib that shadows jq, declare or git, a signal, a deny whose jq could
# not print. DECIDED is set only by _pp_deny and _pp_allow. Any other end runs no_decision,
# which denies when this call is a PR-create as far as text can tell (the MCP tool, or a Bash
# command that holds gh, pr, create in that order once quotes are removed: the test the
# lib-less path below already uses) and stays silent otherwise, so a broken hook does not
# block ordinary commands. The trap is not inherited by `$(...)`. fd 9 is the hook's real
# stdout: the shell can end inside a command whose stdout is redirected, and the trap would
# inherit that redirect. Not covered: a lib that replaces the trap, sets DECIDED, assigns a
# variable the hook reads, redefines a _pp_ function, defines `builtin`, or closes fd 9;
# SIGKILL and the stop and real-time signals; the two exits above this line
# (docs/harness-residuals.md).
exec 9>&1
DECIDED=""
CMD=""
_PP_SIGS='TERM INT HUP PIPE ALRM USR1 USR2 QUIT ABRT XCPU XFSZ VTALRM PROF SYS IO'
_pp_ignore_signals() {
  # shellcheck disable=SC2086
  trap '' $_PP_SIGS
  trap '' PWR 2>/dev/null || :
  trap '' STKFLT 2>/dev/null || :
}
# Named with the hook's prefix so a lib that defines `deny` or `allow` cannot replace them.
_pp_allow() { DECIDED=1; exit 0; }
# _pp_deny builds its JSON inside `$(...)` first; the reason is cut at 8000 characters (one
# argv entry over 128 KB is E2BIG). When jq cannot render it, a static deny is printed: the
# verdict is already known here, so it is never handed back to the trap's text test.
_pp_deny() {
  local j r="$1"
  [ "${#r}" -gt 8000 ] && r="${r:0:8000} [... reason cut at 8000 characters]"
  j=$(jq -n --arg r "$r" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }' 2>/dev/null) || j=""
  _pp_ignore_signals
  DECIDED=1
  case "$j" in
    *'"permissionDecision": "deny"'*) builtin printf '%s\n' "$j" >&9 ;;
    *) builtin printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"pr-preflight-guard: this PR creation is blocked, and the hook could not render its reason (jq failed). The checks are: a fresh preflight pass-stamp for the PR head (run: npm run preflight:fast), a verdict-diff stamp when the PR changes a registered guard or keyword file (run: bash scripts/harness/verdict-diff.sh), and no overlap with files changed on origin/main since the branch forked. Emergency bypass: SKIP_PR_PREFLIGHT=1 in the environment Claude Code was launched from."}}' >&9 ;;
  esac
  exit 0
}
# The text test for "this call creates a PR", used by the trap.
_pp_looks_like_create() {
  [ "$TOOL" = "mcp__github__create_pull_request" ] && return 0
  [ "$TOOL" = "Bash" ] || return 1
  # The raw envelope stands in when the command was never read (a signal that killed the jq
  # reading it left CMD empty, and an empty command read as "not a PR-create").
  local t=${CMD:-$INPUT}
  # In the raw envelope a newline is the two characters backslash-n; drop that pair first, or
  # the backslash strip below would leave an `n` inside a word split by a line continuation.
  [ -n "$CMD" ] || t=${t//\\n/}
  t=${t//\'/}; t=${t//\"/}; t=${t//\\/}; t=${t//$'\n'/}; t=${t//\$/}
  case "$t" in *gh*pr*create*) return 0 ;; esac
  return 1
}
no_decision() {
  [ -n "$DECIDED" ] && return 0
  _pp_ignore_signals
  DECIDED=1
  if _pp_looks_like_create; then
    builtin printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"pr-preflight-guard: the hook ended before it reached a decision (a helper under .claude/hooks/lib/ or scripts/lib/ ended the hook, or the hook was interrupted) on a call that looks like a PR creation, so it cannot say the PR head has a preflight pass-stamp. Fail-closed. Run npm run preflight:fast and try again. Emergency bypass: SKIP_PR_PREFLIGHT=1 in the environment Claude Code was launched from."}}' >&9
  fi
  exit 0
}
trap no_decision EXIT
# A trapped signal would otherwise RETURN to the interrupted command; end the shell instead.
# PWR and STKFLT do not exist in macOS bash, so each is set on its own line that may fail.
# shellcheck disable=SC2086
trap 'no_decision; exit 0' $_PP_SIGS
trap 'no_decision; exit 0' PWR 2>/dev/null || :
trap 'no_decision; exit 0' STKFLT 2>/dev/null || :

# lib_loads <file>: source it in a subshell first. A lib that exits, fails under this file's
# `set -u`, changes the shell options (errexit left on) or the working directory (the hook's
# git calls read the cwd: a lib that ran `cd /` made "not a git repository" an allow), or
# leaves a function named like a builtin or a command this hook calls counts as missing. TWIN of git-safety.sh's lib_loads
# and _gs_no_shadow. The check runs through `builtin`, so a lib that defines a function called
# `builtin` defeats it (docs/harness-residuals.md).
_PP_NO_SHADOW=(. : '[' break builtin cd command compgen continue declare echo eval exec exit
  export false kill local printf pwd read readonly return set shift shopt source test trap true
  type typeset unset wait cat ls grep jq awk sed tr sort dirname head wc tail git comm)
_pp_no_shadow() {
  for _pp_f in "${_PP_NO_SHADOW[@]}"; do
    builtin declare -F -- "$_pp_f" >/dev/null 2>&1 && builtin return 1
  done
  builtin return 0
}
lib_loads() {
  [ "$(_o="$-:$SHELLOPTS:$PWD"; { . "$1"; } >/dev/null 2>&1; _pp_no_shadow && [ "$-:$SHELLOPTS:$PWD" = "$_o" ] && printf loaded)" = loaded ]
}

# Gate BOTH PR-creation paths through the same coverage stamp:
case "$TOOL" in
  Bash)
    # A command that cannot be read is decided by the trap's text test over the raw envelope,
    # not allowed outright.
    CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || { CMD=""; no_decision; }
    # Fork-free: a $(cd ...) subshell here would be the ENTIRE added cost of reaching the
    # shared fast-path helper below (measured ~1.9ms/call; sourcing itself is free) — this
    # HERE now runs on every Bash tool call, not just ones that already matched the old
    # inline filter. The */*) arm is load-bearing: a bare "${BASH_SOURCE[0]%/*}" returns the
    # filename unchanged when invoked with no slash, the source below then fails, and (absent
    # the fall-through design below) could silently skip this DENY gate.
    case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac

    # Necessary-substring fast path via the shared helper (lib/fastpath-filter.sh). This hook
    # runs on EVERY Bash tool call, so keep the hot path cheap (per
    # project_per_bash_hook_overhead).
    #
    # It matched RAW $CMD until 2026-08-16, justified as "cmd_bare only BLANKS characters (never
    # inserts or moves them), so this is a strict superset of the matcher". That premise died when
    # cmd_is_gh_pr_create moved to `cmd_words`, which DELETES quote characters and therefore
    # synthesises literals absent from the raw text: `g"h" pr create --fill` contains no `gh`, so
    # the raw filter exited 0 and this DENY gate never ran — a PR openable with no preflight stamp.
    # Filtering the SAME text the matcher reads is a superset by construction, not by assumption.
    # '*gh*pr*create*' is ONE ordered pattern (gh, then pr, then create, in that order) — not
    # three alternatives — and must stay a single argument to the helper, never split into
    # three (that would change the semantics to "any of gh/pr/create present").
    #
    # If the helper is unsourceable, do NOT exit here — fall through to the primary/fallback
    # split below, which already has its own tested fail-toward-deny handling; losing the
    # cheap pre-filter only costs performance in that (broken-install) case, never a decision.
    # Sourced and called INSIDE one `$(...)` (2026-11-25), never in the hook's own shell:
    # sourced there, a lib that exits took the hook with it, and so did a cmd_fastpath_has
    # that exits. The answer is the function's rc as text; only a clean "1" (no needle) takes
    # the fast way out. Empty means the lib exited, left a shell option changed or a shadowing
    # function (the lib_loads test, inlined to keep this at ONE fork per Bash call), or the
    # function did not return: then the checks below run, as with no filter at all.
    _PP_FP_RC=$(_o="$-:$SHELLOPTS:$PWD"; { . "$HERE/lib/fastpath-filter.sh"; } >/dev/null 2>&1
      _pp_no_shadow && [ "$-:$SHELLOPTS:$PWD" = "$_o" ] && declare -F cmd_fastpath_has >/dev/null || exit 0
      cmd_fastpath_has "$CMD" '*gh*pr*create*' >/dev/null 2>&1; printf '%s' "$?")
    [ "$_PP_FP_RC" = 1 ] && _pp_allow
    # Probed before it is sourced, and the real source discards stdout too (a lib that prints
    # when sourced put its text ahead of the deny JSON).
    if lib_loads "$HERE/lib/cmd-detect.sh" && . "$HERE/lib/cmd-detect.sh" >/dev/null 2>&1 && declare -F cmd_words >/dev/null; then
      words=$(printf '%s' "$CMD" | cmd_words)
      # An empty rendering from a NON-empty command means the awk backend is missing or broken
      # (`declare -F cmd_words` proves the function is DEFINED, not that it WORKS — with awk off
      # PATH the lib sources cleanly and the renderer silently emits nothing). Both the fast path
      # AND the precise matcher below are then blind, so this hook must NOT consult either: it
      # degrades to the raw filter and goes straight to the stamp gate. Without this, an awk-less
      # PATH made `gh pr create --fill` ALLOW outright — no stamp demanded (review, 2026-08-16;
      # mirrors guard-outward-cli.sh's own blank-rendering detector).
      if [ -n "${words//[[:space:]]/}" ]; then
        case "$words" in *gh*pr*create*) : ;; *) _pp_allow ;; esac
      elif [ -n "${CMD//[[:space:]]/}" ]; then
        WORDS_BROKEN=1
        # Same 5-character strip as the stage-1/2 fast path above (quotes,
        # backslash, newline, and the $ sigil cmd_words itself consumes before
        # a quote) — the narrower quote-only strip this fallback used to run
        # left `g$'h' pr create --fill` invisible to this glob even though it
        # demonstrably reconstructs to `gh pr create --fill` under cmd_words
        # (the working-awk control in test-pr-preflight-guard.sh proves it),
        # reopening the exact bypass this hook exists to close on a
        # broken-awk host (review round 4, 2026-08-17).
        _FB=${CMD//\'/}; _FB=${_FB//\"/}; _FB=${_FB//\\/}; _FB=${_FB//$'\n'/}; _FB=${_FB//\$/}
        case "$_FB" in *gh*pr*create*) : ;; *) _pp_allow ;; esac
      fi
    else
      # Lib unsourceable (broken install): cmd_is_gh_pr_create cannot run either, so this hook
      # degrades to "raw text plausibly contains gh pr create -> demand a stamp". Keep the RAW
      # filter here so an unrelated command still exits quietly instead of hitting the stamp
      # gate — without it, a missing lib turns this into a deny-everything gate (caught by
      # test-pr-preflight-guard.sh's "lib-missing leaves unrelated bash alone"). Same 5-character
      # strip as the WORDS_BROKEN branch above (review round 4, 2026-08-17) — this fallback had
      # the identical narrower gap.
      _FB=${CMD//\'/}; _FB=${_FB//\"/}; _FB=${_FB//\\/}; _FB=${_FB//$'\n'/}; _FB=${_FB//\$/}
      case "$_FB" in *gh*pr*create*) : ;; *) _pp_allow ;; esac
    fi
    # Precise detection via the shared, quote-AWARE scanner (.claude/hooks/lib/cmd-detect.sh) — the
    # single source of the strip + command-position matcher across all three PR/commit hooks, so
    # this gate no longer re-derives (and can no longer re-break) a context-free quote strip (the
    # apostrophe-glue / env-runner bypasses of the 2026-07-18 audit /code-review). It rejects a
    # `gh pr create` merely MENTIONED inside a quoted argument. If the lib is UNSOURCEABLE (broken
    # install), FAIL TOWARD DENY: skip the precise check and fall through to the stamp gate.
    # ($HERE and the lib are normally already resolved above; the source here is conditional on
    # the function being absent, so it costs nothing on the common path but keeps this branch
    # correct if the block above is ever moved or removed.)
    # Skipped when the renderer is broken (WORDS_BROKEN): cmd_is_gh_pr_create reads the same
    # empty rendering, so it would return "no match" for a REAL `gh pr create` and exit 0,
    # silently skipping the stamp gate. Falling through to that gate is the fail-closed direction.
    # Called inside `$(...)` (2026-11-25): called directly, a cmd_is_gh_pr_create that EXITS
    # ended the hook with no decision. The answer is its rc as text, and only a clean "1" ("not
    # a PR-create") leaves. Empty or anything else means it could not tell, and the stamp
    # check below runs: the text tests above already said this may be a PR-create. (The lib
    # is not sourced a second time here; the probed source above either defined the function
    # or it is not there.)
    if [ "${WORDS_BROKEN:-0}" != 1 ] && declare -F cmd_is_gh_pr_create >/dev/null; then
      # The "1" is believed only after the matcher has said YES to a known PR-create in the
      # same subshell (security review, 2026-11-25, on main too): cmd_is_gh_pr_create renders
      # the command through cmd_words_deep, and when THAT helper is broken (exits, returns
      # non-zero, is missing) the rendering is empty and the matcher answers a clean 1 for
      # everything, a real PR-create included. A matcher that cannot say yes cannot say no.
      # The known PR-create is shaped like a real call (a second line, a global flag, flags
      # after the verb), because a PARTLY broken matcher passed the bare three words and then
      # missed real commands: one that reads only the first line, one whose suffix anchor
      # rejects anything after `create`, one that fails on longer input (each measured). This
      # checks the shapes in this one string, not every shape (docs/harness-residuals.md).
      _PP_IS_CREATE=$(cmd_is_gh_pr_create $'true\ngh -R o/r pr create --fill --title x' >/dev/null 2>&1 || exit 0
        cmd_is_gh_pr_create "$CMD" >/dev/null 2>&1; printf '%s' "$?")
      [ "$_PP_IS_CREATE" = 1 ] && _pp_allow
    fi
    ;;
  mcp__github__create_pull_request)
    : # the tool call IS the PR-create (default /todo + "prefer MCP" path) — no arg parsing needed.
    ;;
  *)
    _pp_allow   # any other tool — not a PR-create, allow.
    ;;
esac

git rev-parse --git-dir >/dev/null 2>&1 || _pp_allow
HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")

# Check the PR's OWN branch, not whatever the cwd has checked out (2026-10-13). Work happens in
# linked worktrees while the session's cwd stays on the main checkout, so reading cwd HEAD denied
# every worktree PR. When the call names a head branch — MCP `tool_input.head` (optionally
# "owner:branch"), or `--head <b>` / `--head=<b>` / `-H <b>` on the gh CLI — resolve THAT branch
# (local ref first, then origin/<b>; worktree branches are local refs in the shared repo). No head
# named, or an unresolvable one → keep cwd HEAD, the previous behaviour. A named branch whose
# commit has no stamp still denies, so this only changes WHICH commit must be stamped.
HEAD_REF=""
case "$TOOL" in
  Bash)
    # Quoted text (a --title/--body that QUOTES a --head flag) must never pick the head, or a
    # stamp for one branch could cover a PR from another: drop quoted spans first, then accept
    # exactly ONE --head/-H. Zero or several → no head named → cwd HEAD (the fail-closed side).
    UNQUOTED=$(printf '%s' "${CMD:-}" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g")
    HEAD_FLAGS=$(printf '%s\n' "$UNQUOTED" | grep -oE '(^|[[:space:]])(--head[= ]+|-H +)[^[:space:];&|)]+' || true)
    if [ -n "$HEAD_FLAGS" ] && [ "$(printf '%s\n' "$HEAD_FLAGS" | wc -l | tr -d ' ')" = 1 ]; then
      HEAD_REF=$(printf '%s' "$HEAD_FLAGS" | sed -E 's/^[[:space:]]*(--head[= ]+|-H +)//')
    fi
    ;;
  *) HEAD_REF=$(printf '%s' "$INPUT" | jq -r '.tool_input.head // empty' 2>/dev/null || echo "") ;;
esac
HEAD_REF="${HEAD_REF##*:}"
if [ -n "$HEAD_REF" ]; then
  REF_SHA=$(git rev-parse -q --verify "refs/heads/${HEAD_REF}^{commit}" 2>/dev/null ||
    git rev-parse -q --verify "refs/remotes/origin/${HEAD_REF}^{commit}" 2>/dev/null || echo "")
  [ -n "$REF_SHA" ] && HEAD="$REF_SHA"
fi

# Resolve the stamp path from the SAME helper the writer uses (no drift). If the
# helper can't be located, STAMP stays empty → we fall through to DENY: the safe
# direction for a gate, never a silent allow on a path mismatch.
STAMP=""
# Derived from this script's own location, NOT from cwd: `git rev-parse --show-toplevel`
# resolves against wherever the agent last cd'd, so inside a nested repo (a vendored
# checkout, a dependency shipping .git) it would source a DIFFERENT tree's helper. The
# helper that ships beside this hook is the one whose stamp path must be honored.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# NOTE for whoever next changes the stamp-path SCHEME: this reader resolves the helper from
# the tree the hook ships in, while the writer (scripts/preflight.sh) resolves it from the
# tree it runs in. If those two trees hold different versions of the helper, the reader
# looks for a path the writer never wrote — "my preflight passed but PR-create is blocked".
# That is the fail-closed direction, so it is confusing rather than dangerous; change both
# copies together. The `[ -n "$ROOT" ]` below stays load-bearing: a `cd` that fails leaves
# ROOT empty, and STAMPED must then stay 0 so the gate denies.
# STAMPED: HEAD's own per-commit stamp (or the single slot) says it passed. STAMP is only the
# newest pass, named in the deny message.
STAMPED=0
if [ -n "$ROOT" ] && [ -f "$ROOT/scripts/lib/preflight-stamp-path.sh" ]; then
  # shellcheck source=scripts/lib/preflight-stamp-path.sh
  # Probed before it is sourced (2026-11-25). A lib that cannot be loaded leaves STAMPED=0,
  # and the check below denies: a stamp that cannot be read is no stamp.
  if lib_loads "$ROOT/scripts/lib/preflight-stamp-path.sh"; then
  . "$ROOT/scripts/lib/preflight-stamp-path.sh" >/dev/null 2>&1
  STAMP=$(cat "$(preflight_stamp_path)" 2>/dev/null || echo "")
  # preflight_stamp_has runs inside `$(...)` and answers by rc as text: a function that EXITS
  # (even with 0) gives an empty answer, which is not "has".
  if [ -n "$HEAD" ]; then
    _PP_HAS=$(preflight_stamp_has "$HEAD" >/dev/null 2>&1; printf '%s' "$?")
    [ "$_PP_HAS" = 0 ] && STAMPED=1
  fi
  fi
fi

# Read by the agent, which acts on it: a prefix on the command never reaches this hook (it
# reads its own environment), and 3 of the 24 measured denies (2026-10-12..25) were retries
# that tried one.
BYPASS_HINT="Emergency bypass: SKIP_PR_PREFLIGHT=1 in the environment Claude Code was launched from (a prefix on the command does not reach this hook)."

if [ -z "$HEAD" ] || [ "$STAMPED" -ne 1 ]; then
  FOUND="${STAMP:0:7}"; [ -z "$FOUND" ] && FOUND="none"
  # Message only, never acceptance: when git can run no pre-push hook in this tree, "push
  # first" cannot produce a stamp. A relative core.hooksPath (husky's default) resolves per
  # worktree, so a linked worktree without the generated .husky/_ silently runs no hooks —
  # 5 of the 8 denies after #1436. `--git-path hooks` applies git's own resolution.
  HOOKS_NOTE=""
  HOOKS_DIR=$(git rev-parse --git-path hooks 2>/dev/null || echo "")
  if [ -n "$HOOKS_DIR" ] && [ ! -x "$HOOKS_DIR/pre-push" ]; then
    HOOKS_NOTE=" Git runs no pre-push hook in $(git rev-parse --show-toplevel 2>/dev/null) (no runnable ${HOOKS_DIR}/pre-push), so a push from here writes no stamp: run \`npm run preflight:fast\` in this tree, then retry."
  fi
  REASON="Blocked: no fresh preflight pass-stamp for HEAD ${HEAD:0:7} (found: ${FOUND}). Push the branch first — the pre-push fast gate stamps a verified HEAD — or run \`npm run preflight\` for full local parity.${HOOKS_NOTE} Coverage is enforced by CI's required checks, not here. ${BYPASS_HINT}"

  _pp_deny "$REASON"
fi

# --- Verdict-diff stamp for guard and keyword changes (harness diagnosis N7, 2026-11-01) --------
# Fix chains (1552→1554, 1476→1479, 1545→1548, 1491→1499) were each a form the first PR's tests
# never varied; the follow-ups ran generated sets only after review found the gap. A PR whose
# changes touch a path in scripts/harness/verdict-diff/targets.tsv therefore needs that tool's stamp
# for the SAME commit the preflight stamp just covered ($HEAD, the named head if any). The registry
# is read from this hook's tree ($ROOT) and the changed files from origin/main...$HEAD, locally (no
# fetch: the drift check below owns the network). Unreadable registry or no origin/main → deny, the
# preflight stamp's direction. Escape: SKIP_VERDICT_DIFF=1 in Claude Code's launch environment.
if [ -z "${SKIP_VERDICT_DIFF:-}" ]; then
  VD_REG="$ROOT/scripts/harness/verdict-diff/targets.tsv"
  VD_REASON="" VD_HIT=""
  if [ ! -r "$VD_REG" ]; then
    VD_REASON="cannot read the verdict-diff registry ${VD_REG}"
  elif ! VD_CHANGED=$(git diff --name-only "origin/main...${HEAD}" 2>/dev/null); then
    VD_REASON="cannot list this PR's changed files (git diff origin/main...${HEAD:0:7} failed — no origin/main?)"
  else
    while IFS=$'\t' read -r VD_GLOB _; do
      case "$VD_GLOB" in '' | '#'*) continue ;; esac
      while IFS= read -r VD_F; do
        # shellcheck disable=SC2053  # the registry column is a glob on purpose
        if [ -n "$VD_F" ] && [[ "$VD_F" == $VD_GLOB ]]; then VD_HIT="$VD_F"; break 2; fi
      done <<< "$VD_CHANGED"
    done < "$VD_REG"
    if [ -n "$VD_HIT" ]; then
      VD_DIR=""
      if [ -f "$ROOT/scripts/lib/verdict-diff-stamp-path.sh" ]; then
        # shellcheck source=scripts/lib/verdict-diff-stamp-path.sh
        # Probed first; unloadable leaves VD_DIR empty, and the check below denies.
        lib_loads "$ROOT/scripts/lib/verdict-diff-stamp-path.sh" \
          && . "$ROOT/scripts/lib/verdict-diff-stamp-path.sh" >/dev/null 2>&1
        VD_DIR=$(verdict_diff_stamp_dir 2>/dev/null || echo "")
      fi
      if [ -z "$VD_DIR" ] || [ ! -f "$VD_DIR/$HEAD" ]; then
        VD_REASON="this PR changes '${VD_HIT}' (a guard or keyword file) and HEAD ${HEAD:0:7} has no verdict-diff stamp"
      fi
    fi
  fi
  if [ -n "$VD_REASON" ]; then
    REASON="Blocked: ${VD_REASON}. Run \`bash scripts/harness/verdict-diff.sh\` in the PR's tree: it compares the base and head versions over a generated set and stamps HEAD. Paste its CHANGED/GAPS lists into the PR body under '## Verdict changes', saying for each whether it is intended, then retry. Emergency bypass: SKIP_VERDICT_DIFF=1 in the environment Claude Code was launched from (a prefix on the command does not reach this hook)."
    _pp_deny "$REASON"
  fi
fi

# --- Base-branch drift/overlap check (2026-08-28) ------------------------------
# Stamp is fresh for HEAD. Separately: has the base branch advanced, on a file this PR
# ALSO changed, since this branch forked? That's the 2026-08-28 incident replayed —
# branched off a stale local main, re-did an already-merged todo archive, opened a
# duplicate PR (#862, closed unmerged). A bare "is main behind" check would fire on
# nearly every PR in this repo's cadence and this project deliberately runs branch
# protection with strict:false (a stale-but-non-overlapping PR is fine to merge) — so
# this checks file-path OVERLAP specifically, not mere staleness.
# Scope, deliberately narrow: always compares against origin/main (no --base /
# tool_input.base parsing) — every PR in this repo targets main.
# Earlier copy: the review-dispatch mod (.claude/mods/review-dispatch, refuseOverlap) runs the
# same comparison before review (harness diagnosis N3), so a merge of main lands before the
# review instead of after it; this check stays as the backstop for main moving after review.
# Escape: SKIP_PR_DRIFT_CHECK=1 skips just this check (SKIP_PR_PREFLIGHT=1 above already
# skips the whole hook, stamp check included).
if [ -z "${SKIP_PR_DRIFT_CHECK:-}" ]; then
  BASE="main"
  # Fetch into the explicit remote-tracking ref — never read FETCH_HEAD (shared across
  # worktrees/processes; racy — see reference_fetch_head memory). Bounded against a
  # STALLED transfer (http.lowSpeedLimit/Time), not a dead DNS/TCP handshake — same as
  # branch-preflight.sh's twin of this fetch. If the surrounding hook-timeout
  # (.claude/settings.json, currently 10s) treats a killed process as deny rather than
  # allow, a dead network could turn this hygiene-only check into an unintended block —
  # unverified either way (review, 2026-08-28); accepted for now, worth revisiting if seen.
  git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=5 fetch -q \
    origin "refs/heads/${BASE}:refs/remotes/origin/${BASE}" >/dev/null 2>&1 9>&-
  if git rev-parse -q --verify "origin/${BASE}" >/dev/null 2>&1; then
    MISSED=$(git diff --name-only "${HEAD}...origin/${BASE}" 2>/dev/null || echo "")
    if [ -n "$MISSED" ]; then
      MINE=$(git diff --name-only "origin/${BASE}...${HEAD}" 2>/dev/null || echo "")
      OVERLAP=$(comm -12 <(printf '%s\n' "$MISSED" | sort) <(printf '%s\n' "$MINE" | sort))
      if [ -n "$OVERLAP" ]; then
        FIRST=$(printf '%s\n' "$OVERLAP" | head -1)
        REASON="Blocked: '${FIRST}' changed on origin/${BASE} since this branch forked, and this PR also changes it — the same work may already be merged there. Check \`git log origin/${BASE} -- '${FIRST}'\` before opening. Reconcile with \`git fetch origin ${BASE} && git merge --ff-only origin/${BASE}\`, then retry. ${BYPASS_HINT} SKIP_PR_DRIFT_CHECK=1 skips just this check, the same way."
        _pp_deny "$REASON"
      fi
    fi
  fi
fi

_pp_allow   # stamp fresh, no overlapping base drift (or fetch/lookup unavailable) — allow.
