#!/usr/bin/env bash
# Unit test for pr-preflight-guard.sh. Run by CI (Lint · Types · Patterns job).
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pr-preflight-guard.sh"
FAIL=0
assert_contains() { case "$3" in *"$2"*) echo "ok: $1";; *) echo "FAIL: $1 — expected '$2' in: $3"; FAIL=1;; esac; }
assert_empty()    { if [ -z "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $3"; FAIL=1; fi; }

run_hook() { # $1=command  → stdout of hook
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')" | bash "$HOOK"
}

run_hook_tool() { # $1=tool_name  → stdout of hook (the tool call itself is the PR-create)
  printf '{"tool_name":%s,"tool_input":{"title":"x","body":"y"}}' "$(jq -Rn --arg t "$1" '$t')" | bash "$HOOK"
}

HEAD=$(git rev-parse HEAD 2>/dev/null || echo deadbeef)

# 1. Non-create gh commands pass through (no deny).
OUT=$(run_hook "gh pr view 42")
assert_empty "gh pr view passes through" "" "$OUT"

# 2. gh pr create with NO stamp → deny.
rm -f /tmp/ocrecipes-preflight-pass
OUT=$(run_hook "gh pr create --title x --body y")
assert_contains "no stamp denies create" '"permissionDecision": "deny"' "$OUT"

# 3. gh pr create with a FRESH stamp (== HEAD) → allow (no deny output).
echo "$HEAD" > /tmp/ocrecipes-preflight-pass
OUT=$(run_hook "gh pr create --title x --body y")
assert_empty "fresh stamp allows create" "" "$OUT"
rm -f /tmp/ocrecipes-preflight-pass

# 4. Bypass env → allow.
OUT=$(SKIP_PR_PREFLIGHT=1 run_hook "gh pr create --title x --body y")
assert_empty "bypass env allows create" "" "$OUT"

# 5. The phrase merely CONTAINED in a quoted arg (e.g. a commit message) must pass through — not deny.
rm -f /tmp/ocrecipes-preflight-pass
OUT=$(run_hook 'git commit -m "feat(gate): hard-block gh pr create without a stamp"')
assert_empty "phrase inside commit message passes through" "" "$OUT"

# 6. A real chained invocation after && is still caught (deny, no stamp).
rm -f /tmp/ocrecipes-preflight-pass
OUT=$(run_hook 'cd /tmp && gh pr create --title x --body y')
assert_contains "chained gh pr create still denies" '"permissionDecision": "deny"' "$OUT"

# 7. MCP create_pull_request with NO stamp → deny (the default /todo PR-create path).
rm -f /tmp/ocrecipes-preflight-pass
OUT=$(run_hook_tool "mcp__github__create_pull_request")
assert_contains "mcp create with no stamp denies" '"permissionDecision": "deny"' "$OUT"

# 8. MCP create_pull_request with a FRESH stamp (== HEAD) → allow.
echo "$HEAD" > /tmp/ocrecipes-preflight-pass
OUT=$(run_hook_tool "mcp__github__create_pull_request")
assert_empty "mcp create with fresh stamp allows" "" "$OUT"
rm -f /tmp/ocrecipes-preflight-pass

# 9. A non-create github MCP tool passes through (only create_pull_request is gated).
OUT=$(run_hook_tool "mcp__github__list_pull_requests")
assert_empty "other github mcp tool passes through" "" "$OUT"

# 10. MCP create with bypass env → allow.
rm -f /tmp/ocrecipes-preflight-pass
OUT=$(SKIP_PR_PREFLIGHT=1 run_hook_tool "mcp__github__create_pull_request")
assert_empty "mcp create bypass env allows" "" "$OUT"

# 11. A shell separator INSIDE a quoted arg (echo/grep text) must pass through — not deny.
rm -f /tmp/ocrecipes-preflight-pass
OUT=$(run_hook 'echo "see (gh pr create vs the mcp tool)"')
assert_empty "separator-in-quoted-string passes through" "" "$OUT"

# 12. ...but an UNQUOTED `gh pr create` after a separator still denies (regression guard).
rm -f /tmp/ocrecipes-preflight-pass
OUT=$(run_hook 'true; gh pr create --title x')
assert_contains "unquoted separator+create still denies" '"permissionDecision": "deny"' "$OUT"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
