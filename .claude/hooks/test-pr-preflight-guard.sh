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

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
