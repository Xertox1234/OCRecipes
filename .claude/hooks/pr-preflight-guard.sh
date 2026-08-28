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

# Gate BOTH PR-creation paths through the same coverage stamp:
case "$TOOL" in
  Bash)
    CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
    # Necessary-substring fast path. This hook runs on EVERY Bash tool call, so keep the hot path
    # cheap (per project_per_bash_hook_overhead).
    #
    # It matched RAW $CMD until 2026-08-16, justified as "cmd_bare only BLANKS characters (never
    # inserts or moves them), so this is a strict superset of the matcher". That premise died when
    # cmd_is_gh_pr_create moved to `cmd_words`, which DELETES quote characters and therefore
    # synthesises literals absent from the raw text: `g"h" pr create --fill` contains no `gh`, so
    # the raw filter exited 0 and this DENY gate never ran — a PR openable with no preflight stamp.
    # Filtering the SAME text the matcher reads is a superset by construction, not by assumption.
    # STAGE 1 — zero-copy glob on raw $CMD, before the lib is sourced or any awk runs.
    # STAGE 2 — only on a stage-1 miss, retest with the characters cmd_words can DELETE
    # (quotes, backslashes, newlines) removed. cmd_words only deletes those or inserts the
    # letter `x`, and none of `gh`/`pr`/`create` contains an `x`, so any needle the rendering
    # could synthesise is already a substring here: a superset by construction. Four literal
    # substitutions, not one bracket class — the class form costs ~1450ms on a 3KB command
    # under bash 3.2 versus ~5.5ms for these (measured; do not "simplify").
    _PRE=0
    case "$CMD" in *gh*pr*create*) _PRE=1 ;; esac
    if [ "$_PRE" = 0 ]; then
      _T=${CMD//\'/}; _T=${_T//\"/}; _T=${_T//\\/}; _T=${_T//$'\n'/}; _T=${_T//\$/}
      case "$_T" in *gh*pr*create*) _PRE=1 ;; esac
    fi
    [ "$_PRE" = 1 ] || exit 0

    HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if . "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_words >/dev/null; then
      words=$(printf '%s' "$CMD" | cmd_words)
      # An empty rendering from a NON-empty command means the awk backend is missing or broken
      # (`declare -F cmd_words` proves the function is DEFINED, not that it WORKS — with awk off
      # PATH the lib sources cleanly and the renderer silently emits nothing). Both the fast path
      # AND the precise matcher below are then blind, so this hook must NOT consult either: it
      # degrades to the raw filter and goes straight to the stamp gate. Without this, an awk-less
      # PATH made `gh pr create --fill` ALLOW outright — no stamp demanded (review, 2026-08-16;
      # mirrors guard-outward-cli.sh's own blank-rendering detector).
      if [ -n "${words//[[:space:]]/}" ]; then
        case "$words" in *gh*pr*create*) : ;; *) exit 0 ;; esac
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
        case "$_FB" in *gh*pr*create*) : ;; *) exit 0 ;; esac
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
      case "$_FB" in *gh*pr*create*) : ;; *) exit 0 ;; esac
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
    if [ "${WORDS_BROKEN:-0}" != 1 ] \
       && { declare -F cmd_is_gh_pr_create >/dev/null \
            || . "$HERE/lib/cmd-detect.sh" 2>/dev/null; } \
       && declare -F cmd_is_gh_pr_create >/dev/null; then
      cmd_is_gh_pr_create "$CMD" || exit 0
    fi
    ;;
  mcp__github__create_pull_request)
    : # the tool call IS the PR-create (default /todo + "prefer MCP" path) — no arg parsing needed.
    ;;
  *)
    exit 0   # any other tool — not a PR-create, allow.
    ;;
esac

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")

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
# ROOT empty, and STAMP must then remain empty so the gate denies.
if [ -n "$ROOT" ] && [ -f "$ROOT/scripts/lib/preflight-stamp-path.sh" ]; then
  # shellcheck source=scripts/lib/preflight-stamp-path.sh
  . "$ROOT/scripts/lib/preflight-stamp-path.sh"
  STAMP=$(cat "$(preflight_stamp_path)" 2>/dev/null || echo "")
fi

if [ -z "$HEAD" ] || [ "$STAMP" != "$HEAD" ]; then
  FOUND="${STAMP:0:7}"; [ -z "$FOUND" ] && FOUND="none"
  REASON="Blocked: no fresh preflight pass-stamp for HEAD ${HEAD:0:7} (found: ${FOUND}). Push the branch first — the pre-push fast gate stamps a verified HEAD — or run \`npm run preflight\` for full local parity. Coverage is enforced by CI's required checks, not here. Emergency bypass: SKIP_PR_PREFLIGHT=1."

  jq -n --arg r "$REASON" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
  exit 0
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
# Escape: SKIP_PR_DRIFT_CHECK=1 skips just this check (SKIP_PR_PREFLIGHT=1 above already
# skips the whole hook, stamp check included).
if [ -z "${SKIP_PR_DRIFT_CHECK:-}" ]; then
  BASE="main"
  # Fetch into the explicit remote-tracking ref — never read FETCH_HEAD (shared across
  # worktrees/processes; racy — see reference_fetch_head memory). Bounded against a
  # STALLED transfer, not a dead DNS/TCP handshake — same accepted asymmetry as
  # branch-preflight.sh's twin of this fetch; a slow hook on a dead network still
  # fails open below.
  git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=5 fetch -q \
    origin "refs/heads/${BASE}:refs/remotes/origin/${BASE}" 2>/dev/null
  if git rev-parse -q --verify "origin/${BASE}" >/dev/null 2>&1; then
    MISSED=$(git diff --name-only "HEAD...origin/${BASE}" 2>/dev/null || echo "")
    if [ -n "$MISSED" ]; then
      MINE=$(git diff --name-only "origin/${BASE}...HEAD" 2>/dev/null || echo "")
      OVERLAP=$(comm -12 <(printf '%s\n' "$MISSED" | sort) <(printf '%s\n' "$MINE" | sort))
      if [ -n "$OVERLAP" ]; then
        FIRST=$(printf '%s\n' "$OVERLAP" | head -1)
        REASON="Blocked: '${FIRST}' changed on origin/${BASE} since this branch forked, and this PR also changes it — the same work may already be merged there. Check \`git log origin/${BASE} -- '${FIRST}'\` before opening. Reconcile with \`git fetch origin ${BASE} && git merge --ff-only origin/${BASE}\`, then retry. Emergency bypass: SKIP_PR_PREFLIGHT=1 (or SKIP_PR_DRIFT_CHECK=1 for just this check)."
        jq -n --arg r "$REASON" '{
          "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": $r
          }
        }'
        exit 0
      fi
    fi
  fi
fi

exit 0   # stamp fresh, no overlapping base drift (or fetch/lookup unavailable) — allow.
