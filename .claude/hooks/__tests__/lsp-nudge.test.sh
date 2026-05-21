#!/usr/bin/env bash
# Fixture tests for lsp-nudge.sh. A "nudge" = output contains "symbol search".
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lsp-nudge.sh"
PASS=0; FAIL=0
run() { printf '%s' "$1" | bash "$HOOK" 2>/dev/null; }
expect_nudge() { if run "$2" | grep -q "symbol search"; then echo "ok: $1"; PASS=$((PASS+1)); else echo "FAIL (expected nudge): $1"; FAIL=$((FAIL+1)); fi; }
expect_quiet() { if run "$2" | grep -q "symbol search"; then echo "FAIL (expected quiet): $1"; FAIL=$((FAIL+1)); else echo "ok: $1"; PASS=$((PASS+1)); fi; }
exit0() { printf '%s' "$2" | bash "$HOOK" >/dev/null 2>&1; if [ $? -eq 0 ]; then echo "ok(exit0): $1"; PASS=$((PASS+1)); else echo "FAIL(exit0): $1"; FAIL=$((FAIL+1)); fi; }

S='"session_id":"TESTSESSION"'
expect_nudge "camelCase grep on ts" "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn 'getUserById' server/ --include='*.ts'\"}}"
expect_quiet "plain text phrase"     "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn 'TODO fix later' server/\"}}"
expect_quiet "fixed-string -F"        "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -F 'getUserById' notes.txt\"}}"
expect_quiet "regex metachars"        "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn 'get.*ById' server/\"}}"
expect_quiet "non-Bash tool"          "{$S,\"tool_name\":\"Read\",\"tool_input\":{\"command\":\"grep getUserById\"}}"
expect_quiet "ci infra"               "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npm run ci:failed-logs\"}}"
exit0 "always exit 0 on nudge"        "{$S,\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"grep -rn 'parseRecipe' client/ --include='*.tsx'\"}}"

echo "---"; echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
