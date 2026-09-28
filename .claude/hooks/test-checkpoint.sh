#!/usr/bin/env bash
# Tests for scripts/checkpoint.sh, .claude/hooks/checkpoint.sh and cmd-detect's
# work-discarder detector (spec 2026-09-27 §4, §7.1). No Postgres needed — runs in CI.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
CKPT="$PROJECT_ROOT/scripts/checkpoint.sh"
HOOK="$HOOK_DIR/checkpoint.sh"
FAIL=0
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected [$3], got [$2]"; FAIL=1; fi; }
assert_ne()       { if [ "$2" != "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — both [$2]"; FAIL=1; fi; }
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got [$2]"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing [$3] in [$2]"; FAIL=1; fi; }

# --- cmd_git_work_discarder_verb --------------------------------------------------------
verb() { ( . "$HOOK_DIR/lib/cmd-detect.sh" >/dev/null 2>&1; cmd_git_work_discarder_verb "$1" ) 2>/dev/null; }
assert_eq "detector: checkout --"          "$(verb 'git checkout -- .')" "checkout"
assert_eq "detector: restore"              "$(verb 'git restore a.ts')" "restore"
assert_eq "detector: reset --hard"         "$(verb 'git reset --hard')" "reset"
assert_eq "detector: stash"                "$(verb 'git stash')" "stash"
assert_eq "detector: clean -fd"            "$(verb 'git clean -fd')" "clean"
assert_eq "detector: switch -f"            "$(verb 'git switch -f b')" "switch"
assert_eq "detector: -C global then verb"  "$(verb 'git -C /tmp/somewhere checkout -- x')" "checkout"
assert_eq "detector: after &&"             "$(verb 'npm test && git stash')" "stash"
assert_empty "detector: status"            "$(verb 'git status')"
assert_empty "detector: -C path holds verb" "$(verb 'git -C /tmp/checkout-dir status')"
assert_empty "detector: quoted mention"    "$(verb 'echo "git checkout -- x"')"
assert_empty "detector: echo then git"     "$(verb 'echo git checkout -- x')"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
