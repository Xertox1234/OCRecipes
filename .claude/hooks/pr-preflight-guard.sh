#!/usr/bin/env bash
# PreToolUse(Bash) — hard-block `gh pr create` unless a fresh FULL `npm run preflight`
# pass-stamp exists for the current HEAD. This guarantees lint/type/test/COVERAGE parity
# before a PR can open (the single-push /todo auto-merge flow has no PR at push time, so the
# pre-push hook cannot gate it — this does).
# Escape (emergencies): set SKIP_PR_PREFLIGHT=1 in the shell that launched Claude Code.
set -uo pipefail

[ -n "${SKIP_PR_PREFLIGHT:-}" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Match `gh pr create` only when `gh` is in command position (start-of-command or after a shell
# separator: ; & | () — NOT when the phrase merely appears inside a quoted argument such as a
# commit message. Intentionally stricter than pr-verify.sh's detector (that hook is non-blocking
# and can afford looser matching; we diverge here on purpose).
printf '%s' "$CMD" | grep -Eq '(^|[;&|(])[[:space:]]*gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)' || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
STAMP=$(cat /tmp/ocrecipes-preflight-pass 2>/dev/null || echo "")

if [ -n "$HEAD" ] && [ "$STAMP" = "$HEAD" ]; then
  exit 0   # fresh full-preflight pass for this commit — allow.
fi

FOUND="${STAMP:0:7}"; [ -z "$FOUND" ] && FOUND="none"
REASON="Blocked: run \`npm run preflight\` (full CI parity incl. coverage) before opening a PR. No fresh pass-stamp for HEAD ${HEAD:0:7} (found: ${FOUND}). This catches the lint/test/coverage failures that otherwise reach CI. Emergency bypass: SKIP_PR_PREFLIGHT=1."

jq -n --arg r "$REASON" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": $r
  }
}'
exit 0
