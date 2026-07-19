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
    # First neutralize backslash-escaped quotes, THEN strip single/double-quoted spans, so
    # `gh pr create` mentioned INSIDE a quoted argument (a commit message, an `echo`/`grep`
    # string) is never mistaken for a real invocation. The escape pre-pass is load-bearing:
    # without it a \" inside one argument pairs with the quote OPENING a later argument, and
    # the strip deletes the separator plus a REAL `gh pr create` between them — a silent allow
    # on the gate (2026-07-18 harness-audit Phase 6 review). Residual mis-strips fail
    # deny-side: leftover text can only make the match MORE likely.
    CMD_BARE=$(printf '%s' "$CMD" | sed "s/\\\\[\"']//g; s/'[^']*'//g; s/\"[^\"]*\"//g")
    # Then match `gh pr create` only when `gh` is in command position (start-of-command or after a
    # shell separator: ; & | ( ), allowing env-assignment prefixes (`FOO=1 gh pr create`) so they
    # cannot evade the gate — the value class is `*` not `+` because quote-stripping can leave
    # `FOO= `. Intentionally stricter than pr-verify.sh's detector (that hook is non-blocking and
    # can afford looser matching; we diverge here on purpose).
    printf '%s' "$CMD_BARE" | grep -Eq '(^|[;&|(])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+create([[:space:]]|[)]|$)' || exit 0
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
