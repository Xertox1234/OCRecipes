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

rel() { printf '%s' "$1" | emit_write_targets --relative | tr '\n' ' '; }
res() { printf '%s' "$1" | resolve_write_targets "$2" | tr '\n' ' '; }
assert_eq "rel: rm file"                 "$(rel 'rm foo.ts')" "foo.ts "
assert_eq "rel: rm -rf skips options"    "$(rel 'rm -rf dir/a')" "dir/a "
assert_eq "rel: redirect"                "$(rel 'echo x > out.txt')" "out.txt "
assert_eq "rel: append redirect"         "$(rel 'echo x >> log/out.txt')" "log/out.txt "
assert_eq "rel: cp destination only"     "$(rel 'cp a.ts b.ts')" "b.ts "
assert_eq "rel: tee after a pipe"        "$(rel 'echo x | tee t1.txt t2.txt')" "t1.txt t2.txt "
assert_eq "rel: sed -i skips the script" "$(rel "sed -i 's/a/b/' f.ts")" "f.ts "
assert_eq "rel: sed -i -e skips the script" "$(rel "sed -i -e 's/a/b/' f.ts")" "f.ts "
assert_eq "rel: after cd → none"         "$(rel 'cd sub && rm foo.ts')" ""
assert_eq "rel: pushd → none"            "$(rel 'pushd sub; rm foo.ts')" ""
assert_eq "rel: absolute kept after cd"  "$(rel 'cd sub && rm /abs/x.ts')" "/abs/x.ts "
assert_eq "rel: env prefix before the verb is not a target" "$(rel 'FOO=1 rm x.ts')" "x.ts "
assert_eq "rel: quoted write word"       "$(rel 'git commit -m "rm foo.ts"')" ""
assert_eq "rel: non-writing command"     "$(rel 'ls -la src')" ""
assert_eq "rel: mixed abs + rel"         "$(rel 'rm /abs/a.ts b.ts')" "/abs/a.ts b.ts "
# Review Focus 1: a quoted path with a space is ONE target.
SP=$(printf '%s' 'rm "my file.ts"' | emit_write_targets --relative)
assert_eq "rel: quoted path with a space is one line" "$(printf '%s\n' "$SP" | wc -l | tr -d ' ')" "1"
assert_eq "rel: quoted path with a space intact" "$SP" "my file.ts"
assert_eq "resolve: joined to cwd, ./ stripped" "$(res 'rm ./foo.ts' /repo)" "/repo/foo.ts "
assert_eq "resolve: absolute kept"              "$(res 'rm /x/y.ts' /repo)" "/x/y.ts "
assert_eq "resolve: no cwd → relative dropped"  "$(res 'rm foo.ts' '')" ""

# Fix round 1 (review): a glued fd number before a redirect is not a relative target; macOS
# `sed -i ''` doesn't make the script a target; a real fd-named file is still a target; the
# cmdseen gate fires for a write verb anywhere in the segment; cp/mv only ever reports the
# LAST arg, whether abs or rel.
assert_eq "rel: fd number glued to a redirect is not a target" "$(rel 'mv a.ts b.ts 2>/dev/null')" "/dev/null b.ts "
assert_eq "rel: fd-dup 2>&1 is not a target"                    "$(rel 'rm x 2>&1')" "x "
assert_eq "rel: macOS sed -i '' skips the script"               "$(rel "sed -i '' 's/a/b/' f.ts")" "f.ts "
assert_eq "rel: rm with an empty-quoted arg yields no target"   "$(rel 'rm ""')" ""
assert_eq "rel: a real file named 2 is still a target"          "$(rel 'echo x > 2')" "2 "
assert_eq "rel: cmdseen fires for a write verb after sudo"       "$(rel 'sudo rm x')" "x "
assert_eq "rel: cp with a relative source, abs destination"     "$(rel 'cp a.ts /abs/b.ts')" "/abs/b.ts "
assert_eq "rel: cp with an abs source, relative destination"    "$(rel 'cp /abs/src.ts dst.ts')" "dst.ts "

# git-safety fails CLOSED when the lib is missing and a contract is active; the same
# command with the lib intact is ALLOWED (target outside the main checkout) — the pair is
# what shows the deny comes from the missing lib, not from the ordinary contract check.
FX=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/wt-failclosed-XXXXXX")" && pwd -P)
SID="wtfc-$$"; REG="/tmp/claude-worktree-contracts-$SID"
trap 'rm -rf "$FX" "$REG"' EXIT
mkdir -p "$FX/intact" "$FX/broken" "$FX/stubexit" "$FX/stubunset" "$FX/main" "$REG"
cp -R "$HOOK_DIR/." "$FX/intact/"; cp -R "$HOOK_DIR/." "$FX/broken/"; rm -f "$FX/broken/lib/write-targets.sh"
# Two more broken flavors: the lib FILE is present (so a naive `[ -f ... ] || deny` guard
# would miss both), but its BODY breaks the hook's own shell when sourced directly — a brace
# group is not a subshell. stubexit exits the whole script early; stubunset trips this file's
# `set -uo pipefail` on an unset-variable expansion. Both must fail CLOSED exactly like the
# missing-lib case above, not fail open with zero targets.
cp -R "$HOOK_DIR/." "$FX/stubexit/";   printf 'exit 0\n' > "$FX/stubexit/lib/write-targets.sh"
cp -R "$HOOK_DIR/." "$FX/stubunset/"; printf 'BAD="${DEFINITELY_NOT_SET}"\n' > "$FX/stubunset/lib/write-targets.sh"
git -C "$FX/main" init -q
printf '%s' "$FX/some-worktree" > "$REG/wt1"
IN=$(jq -n --arg c "rm $FX/elsewhere/x.ts" --arg cwd "$FX/main" --arg sid "$SID" \
  '{tool_name:"Bash", session_id:$sid, cwd:$cwd, tool_input:{command:$c}}')
DEC_OK=$(printf '%s' "$IN" | bash "$FX/intact/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)
DEC_BAD=$(printf '%s' "$IN" | bash "$FX/broken/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)
DEC_STUBEXIT=$(printf '%s' "$IN" | bash "$FX/stubexit/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)
DEC_STUBUNSET=$(printf '%s' "$IN" | bash "$FX/stubunset/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)
assert_eq "git-safety: lib intact → write outside main allowed" "${DEC_OK:-none}" "none"
assert_eq "git-safety: lib missing → fails CLOSED" "$DEC_BAD" "deny"
assert_eq "git-safety: lib present but exit-0 body → fails CLOSED" "${DEC_STUBEXIT:-none}" "deny"
assert_eq "git-safety: lib present but unset-var body → fails CLOSED" "${DEC_STUBUNSET:-none}" "deny"
REASON=$(printf '%s' "$IN" | bash "$FX/broken/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
assert_contains "git-safety: fail-closed reason names the missing lib" "$REASON" "lib/write-targets.sh did not load"
REASON_STUBEXIT=$(printf '%s' "$IN" | bash "$FX/stubexit/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
assert_contains "git-safety: fail-closed reason names the lib for the exit-0 stub" "$REASON_STUBEXIT" "lib/write-targets.sh did not load"
REASON_STUBUNSET=$(printf '%s' "$IN" | bash "$FX/stubunset/git-safety.sh" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
assert_contains "git-safety: fail-closed reason names the lib for the unset-var stub" "$REASON_STUBUNSET" "lib/write-targets.sh did not load"

. "$HOOK_DIR/lib/mutants.sh"
mutant "cd/pushd guard dropped" ".claude/hooks/lib/write-targets.sh" \
  's/if \(rel && !saw_cd\) for/if (rel) for/'
mutant "sed script not skipped" ".claude/hooks/lib/write-targets.sh" \
  's/else if \(has_sed && sedpend\) sedpend = 0/else if (0) sedpend = 0/'
mutant "git-safety fail-closed check removed" ".claude/hooks/git-safety.sh" \
  's/declare -F emit_write_targets >\/dev\/null [|][|] deny/true || deny/'
mutant "git-safety lib probe forced ok" ".claude/hooks/git-safety.sh" \
  's/^_WT_OK=\$\(.*\)$/_WT_OK=ok/'
run_mutants "$PROJECT_ROOT" ".claude/hooks/test-write-targets.sh" || FAIL=1

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
