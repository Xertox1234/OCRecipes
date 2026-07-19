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
    # Necessary-substring fast path: `cmd_bare` only BLANKS characters (never inserts or moves
    # them), so any command the precise matcher would DENY must contain the literals `gh`, `pr`
    # and `create`, in order, in the RAW command. If they are absent, no match is possible — skip
    # the subshell + lib source. This hook runs on EVERY Bash tool call, so keep the hot path
    # cheap (per project_per_bash_hook_overhead). This is a SAFE fast path, not a lossy pre-guard:
    # being a strict superset of the matcher, it can only short-circuit commands the matcher would
    # also miss — never a bypass.
    case "$CMD" in *gh*pr*create*) : ;; *) exit 0 ;; esac
    # Precise detection via the shared, quote-AWARE scanner (.claude/hooks/lib/cmd-detect.sh) — the
    # single source of the strip + command-position matcher across all three PR/commit hooks, so
    # this gate no longer re-derives (and can no longer re-break) a context-free quote strip (the
    # apostrophe-glue / env-runner bypasses of the 2026-07-18 audit /code-review). It rejects a
    # `gh pr create` merely MENTIONED inside a quoted argument. If the lib is UNSOURCEABLE (broken
    # install), FAIL TOWARD DENY: skip the precise check and fall through to the stamp gate (the
    # fast path already established the raw command plausibly contains `gh pr create`).
    HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if . "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_gh_pr_create >/dev/null; then
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
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
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
