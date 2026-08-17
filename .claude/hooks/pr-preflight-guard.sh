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
    # The lib is sourced first now so $words exists; a broken/unsourceable lib skips the fast path
    # entirely and falls through to the stamp gate, preserving the fail-toward-DENY behaviour.
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
        case "$CMD" in *gh*pr*create*) : ;; *) exit 0 ;; esac
      fi
    else
      # Lib unsourceable (broken install): cmd_is_gh_pr_create cannot run either, so this hook
      # degrades to "raw text plausibly contains gh pr create -> demand a stamp". Keep the RAW
      # filter here so an unrelated command still exits quietly instead of hitting the stamp
      # gate — without it, a missing lib turns this into a deny-everything gate (caught by
      # test-pr-preflight-guard.sh's "lib-missing leaves unrelated bash alone").
      case "$CMD" in *gh*pr*create*) : ;; *) exit 0 ;; esac
    fi
    # Precise detection via the shared, quote-AWARE scanner (.claude/hooks/lib/cmd-detect.sh) — the
    # single source of the strip + command-position matcher across all three PR/commit hooks, so
    # this gate no longer re-derives (and can no longer re-break) a context-free quote strip (the
    # apostrophe-glue / env-runner bypasses of the 2026-07-18 audit /code-review). It rejects a
    # `gh pr create` merely MENTIONED inside a quoted argument. If the lib is UNSOURCEABLE (broken
    # install), FAIL TOWARD DENY: skip the precise check and fall through to the stamp gate.
    # ($HERE and the lib are already resolved by the fast path above; re-sourcing is idempotent
    # and keeps this branch correct even if the fast-path block is ever moved or removed.)
    # Skipped when the renderer is broken (WORDS_BROKEN): cmd_is_gh_pr_create reads the same
    # empty rendering, so it would return "no match" for a REAL `gh pr create` and exit 0,
    # silently skipping the stamp gate. Falling through to that gate is the fail-closed direction.
    if [ "${WORDS_BROKEN:-0}" != 1 ] \
       && . "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_gh_pr_create >/dev/null; then
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

if [ -n "$HEAD" ] && [ "$STAMP" = "$HEAD" ]; then
  exit 0   # fresh pass-stamp for this commit (fast or full) — allow.
fi

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
