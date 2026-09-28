#!/usr/bin/env bash
# Tests for .claude/hooks/lib/write-targets.sh (spec 2026-09-27 §5.2) and git-safety.sh's
# fail-closed behavior when that lib is missing (plan refinement 4). No Postgres needed.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
FAIL=0
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected [$3], got [$2]"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing [$3] in [$2]"; FAIL=1; fi; }
. "$HOOK_DIR/lib/write-targets.sh" 2>/dev/null
abs() { printf '%s' "$1" | emit_write_targets | tr '\n' ' '; }

assert_eq "default: absolute rm target" "$(abs 'rm /abs/x.ts')" "/abs/x.ts "
assert_eq "default: relative ignored"    "$(abs 'rm foo.ts /abs/x')" "/abs/x "
assert_eq "default: quoted message"      "$(abs 'git commit -m "writes > /main/out"')" ""

# git-safety fails CLOSED when the lib is missing and a contract is active; the same
# command with the lib intact is ALLOWED (target outside the main checkout) — the pair is
# what shows the deny comes from the missing lib, not from the ordinary contract check.
FX=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/wt-failclosed-XXXXXX")" && pwd -P)
SID="wtfc-$$"; REG="/tmp/claude-worktree-contracts-$SID"
trap 'rm -rf "$FX" "$REG"' EXIT
mkdir -p "$FX/intact" "$FX/broken" "$FX/main" "$REG"
cp -R "$HOOK_DIR/." "$FX/intact/"; cp -R "$HOOK_DIR/." "$FX/broken/"; rm -f "$FX/broken/lib/write-targets.sh"
git -C "$FX/main" init -q
printf '%s' "$FX/some-worktree" > "$REG/wt1"
IN=$(jq -n --arg c "rm $FX/elsewhere/x.ts" --arg cwd "$FX/main" --arg sid "$SID" \
  '{tool_name:"Bash", session_id:$sid, cwd:$cwd, tool_input:{command:$c}}')
DEC_OK=$(printf '%s' "$IN" | bash "$FX/intact/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)
DEC_BAD=$(printf '%s' "$IN" | bash "$FX/broken/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)
assert_eq "git-safety: lib intact → write outside main allowed" "${DEC_OK:-none}" "none"
assert_eq "git-safety: lib missing → fails CLOSED" "$DEC_BAD" "deny"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
