#!/usr/bin/env bash
# Unit test for merge-approval-guard.sh. Run by CI (Lint · Types · Patterns job).
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/merge-approval-guard.sh"
FAIL=0
assert_contains() { case "$3" in *"$2"*) echo "ok: $1";; *) echo "FAIL: $1 — expected '$2' in: $3"; FAIL=1;; esac; }
assert_empty()    { if [ -z "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $3"; FAIL=1; fi; }

run_hook() { # $1=command  → stdout of hook
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')" | bash "$HOOK"
}

run_hook_tool() { # $1=tool_name  → stdout of hook (the tool call itself is the merge)
  printf '{"tool_name":%s,"tool_input":{"pullNumber":626}}' "$(jq -Rn --arg t "$1" '$t')" | bash "$HOOK"
}

# 1. Non-merge gh commands pass through (no deny).
OUT=$(run_hook "gh pr view 626")
assert_empty "gh pr view passes through" "" "$OUT"

# 2. Bare `gh pr merge` (no --auto) → deny (the incident this hook exists to prevent).
OUT=$(run_hook "gh pr merge 626 --squash --delete-branch")
assert_contains "immediate gh pr merge denies" '"permissionDecision": "deny"' "$OUT"

# 3. `gh pr merge --auto` → allow (the established /todo guard-eligible arming path).
OUT=$(run_hook "gh pr merge 626 --auto --squash --delete-branch")
assert_empty "auto-armed gh pr merge allows" "" "$OUT"

# 4. mcp__github__merge_pull_request → always deny (no arm-only mode exists for this tool).
OUT=$(run_hook_tool "mcp__github__merge_pull_request")
assert_contains "mcp merge_pull_request denies" '"permissionDecision": "deny"' "$OUT"

# 5. A non-merge github MCP tool passes through (only merge_pull_request is gated).
OUT=$(run_hook_tool "mcp__github__list_pull_requests")
assert_empty "other github mcp tool passes through" "" "$OUT"

# 6. Bypass env → allow, for both paths.
OUT=$(ALLOW_DIRECT_MERGE=1 run_hook "gh pr merge 626 --squash --delete-branch")
assert_empty "bypass env allows Bash merge" "" "$OUT"
OUT=$(ALLOW_DIRECT_MERGE=1 run_hook_tool "mcp__github__merge_pull_request")
assert_empty "bypass env allows mcp merge" "" "$OUT"

# 7. The phrase merely CONTAINED in a quoted arg (e.g. a commit message) must pass through — not deny.
OUT=$(run_hook 'git commit -m "docs: explain why gh pr merge needs a human here"')
assert_empty "phrase inside commit message passes through" "" "$OUT"

# 8. A real chained invocation after && is still caught (deny, no --auto).
OUT=$(run_hook 'cd /tmp && gh pr merge 626 --squash --delete-branch')
assert_contains "chained gh pr merge still denies" '"permissionDecision": "deny"' "$OUT"

# 9. A shell separator INSIDE a quoted arg (echo/grep text) must pass through — not deny.
OUT=$(run_hook 'echo "see (gh pr merge vs the mcp tool)"')
assert_empty "separator-in-quoted-string passes through" "" "$OUT"

# 10. ...but an UNQUOTED `gh pr merge` after a separator still denies (regression guard).
OUT=$(run_hook 'true; gh pr merge 626 --squash')
assert_contains "unquoted separator+merge still denies" '"permissionDecision": "deny"' "$OUT"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
