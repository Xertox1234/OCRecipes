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
    if . "$HERE/lib/fastpath-filter.sh" 2>/dev/null && declare -F cmd_fastpath_has >/dev/null; then
      cmd_fastpath_has "$CMD" '*gh*pr*create*' || exit 0
    fi
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
# ROOT empty, and STAMP must then remain empty so the gate denies.
if [ -n "$ROOT" ] && [ -f "$ROOT/scripts/lib/preflight-stamp-path.sh" ]; then
  # shellcheck source=scripts/lib/preflight-stamp-path.sh
  . "$ROOT/scripts/lib/preflight-stamp-path.sh"
  STAMP=$(cat "$(preflight_stamp_path)" 2>/dev/null || echo "")
fi

# Read by the agent, which acts on it: a prefix on the command never reaches this hook (it
# reads its own environment), and 3 of the 24 measured denies (2026-10-12..25) were retries
# that tried one.
BYPASS_HINT="Emergency bypass: SKIP_PR_PREFLIGHT=1 in the environment Claude Code was launched from (a prefix on the command does not reach this hook)."

if [ -z "$HEAD" ] || [ "$STAMP" != "$HEAD" ]; then
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

  jq -n --arg r "$REASON" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
  exit 0
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
        . "$ROOT/scripts/lib/verdict-diff-stamp-path.sh"
        VD_DIR=$(verdict_diff_stamp_dir 2>/dev/null || echo "")
      fi
      if [ -z "$VD_DIR" ] || [ ! -f "$VD_DIR/$HEAD" ]; then
        VD_REASON="this PR changes '${VD_HIT}' (a guard or keyword file) and HEAD ${HEAD:0:7} has no verdict-diff stamp"
      fi
    fi
  fi
  if [ -n "$VD_REASON" ]; then
    REASON="Blocked: ${VD_REASON}. Run \`bash scripts/harness/verdict-diff.sh\` in the PR's tree: it compares the base and head versions over a generated set and stamps HEAD. Paste its CHANGED/GAPS lists into the PR body under '## Verdict changes', saying for each whether it is intended, then retry. Emergency bypass: SKIP_VERDICT_DIFF=1 in the environment Claude Code was launched from (a prefix on the command does not reach this hook)."
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
    origin "refs/heads/${BASE}:refs/remotes/origin/${BASE}" 2>/dev/null
  if git rev-parse -q --verify "origin/${BASE}" >/dev/null 2>&1; then
    MISSED=$(git diff --name-only "${HEAD}...origin/${BASE}" 2>/dev/null || echo "")
    if [ -n "$MISSED" ]; then
      MINE=$(git diff --name-only "origin/${BASE}...${HEAD}" 2>/dev/null || echo "")
      OVERLAP=$(comm -12 <(printf '%s\n' "$MISSED" | sort) <(printf '%s\n' "$MINE" | sort))
      if [ -n "$OVERLAP" ]; then
        FIRST=$(printf '%s\n' "$OVERLAP" | head -1)
        REASON="Blocked: '${FIRST}' changed on origin/${BASE} since this branch forked, and this PR also changes it — the same work may already be merged there. Check \`git log origin/${BASE} -- '${FIRST}'\` before opening. Reconcile with \`git fetch origin ${BASE} && git merge --ff-only origin/${BASE}\`, then retry. ${BYPASS_HINT} SKIP_PR_DRIFT_CHECK=1 skips just this check, the same way."
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
