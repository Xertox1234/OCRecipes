#!/usr/bin/env bash
# Tests for todo-verifier-record-writer.sh — run from project root. Hermetic: stdin JSON and
# fixture transcripts only; records land in a throwaway REVIEW_STAMP_ROOT.
set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HOOKS_DIR/todo-verifier-record-writer.sh"
PASS=0; FAIL=0
ROOT=$(mktemp -d "/tmp/todo-verifier-record-writer-test-$$-XXXX")
trap 'rm -rf "$ROOT"' EXIT
# The writer waits for a late hand-back (case 12). Off for every other case.
export TODO_VERIFIER_HANDBACK_WAIT_SECS=0

ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

SHA=1234567890abcdef1234567890abcdef12345678

# $1 = case name: each case gets a private stamp root so cases cannot see each other's records.
run_hook() { REVIEW_STAMP_ROOT="$ROOT/case-$1" bash "$HOOK" >/dev/null 2>&1; }
rec() { printf '%s/case-%s/%s/verifier/todo-verifier.json' "$ROOT" "$1" "${2:-$SHA}"; }

payload() {  # $1=agent_type  $2=last_assistant_message (may be empty -> null)  $3=transcript path
  jq -n --arg t "$1" --arg m "$2" --arg tp "${3:-}" \
    '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
      last_assistant_message:(if $m == "" then null else $m end),
      agent_transcript_path:(if $tp == "" then null else $tp end)}'
}

# The shape a real typed todo-verifier delivered on 2026-11-17: the last assistant entry is a
# SubagentHandback tool_use only, with no text block. $1 = file, rest = hand-back bodies.
transcript() {
  local f="$1"; shift
  : > "$f"
  jq -cn '{type:"user", message:{content:[{type:"text", text:"WORKTREE: /x"}]}}' >> "$f"
  for body in "$@"; do
    jq -cn --arg b "$body" \
      '{type:"assistant", message:{content:[{type:"tool_use", name:"SubagentHandback", input:{message:$b}}]}}' >> "$f"
  done
}

reply() {  # $1=verdict line value  $2=not_met  $3=criteria_edited
  printf 'Criterion 1: met — server/foo.ts:12\n\nVERIFIED-SHA: %s\nVERDICT: %s\nCOUNTS: met=3 not_met=%s needs_person=1 moved=0\nCRITERIA_EDITED: %s\nTEST_EDITS: none\n' \
    "$SHA" "$1" "$2" "$3"
}
PASS_MSG=$(reply pass 0 no)
FAIL_MSG=$(reply fail 1 no)

# 1. A pass reply delivered as text writes a record with every field.
payload todo-verifier "$PASS_MSG" | run_hook c1
f=$(rec c1)
[ -f "$f" ] && ok "pass reply writes a record" || bad "pass reply writes a record"
[ "$(jq -r .verdict "$f" 2>/dev/null)" = "pass" ] && ok "verdict recorded" || bad "verdict recorded"
[ "$(jq -r .head_sha "$f" 2>/dev/null)" = "$SHA" ] && ok "head_sha recorded" || bad "head_sha recorded"
[ "$(jq -r '"\(.met) \(.not_met) \(.needs_person) \(.moved)"' "$f" 2>/dev/null)" = "3 0 1 0" ] \
  && ok "counts recorded as numbers" || bad "counts recorded as numbers" "$(cat "$f" 2>/dev/null)"
[ "$(jq -r .criteria_edited "$f" 2>/dev/null)" = "no" ] && ok "criteria_edited recorded" || bad "criteria_edited recorded"
[ "$(jq -r .agent_type "$f" 2>/dev/null)" = "todo-verifier" ] && ok "agent_type recorded" || bad "agent_type recorded"
[ "$(jq -r .written_by "$f" 2>/dev/null)" = "todo-verifier-record-writer.sh" ] && ok "written_by recorded" || bad "written_by recorded"
# The reviewers' directory must hold no *.json from this hook: merge-review-guard.sh reads every
# *.json at that depth and denies on any verdict that is not clean or advisory.
[ -z "$(find "$ROOT/case-c1/$SHA" -maxdepth 1 -name '*.json' 2>/dev/null)" ] \
  && ok "nothing written beside the reviewers' records" || bad "nothing written beside the reviewers' records"

# 2. Only the todo-verifier type writes. A general-purpose fallback run and a roster reviewer
#    carrying the same block write nothing (the fallback then HOLDs, the safe direction).
payload general-purpose "$PASS_MSG" | run_hook c2
payload code-reviewer "$PASS_MSG" | run_hook c2
[ -z "$(find "$ROOT/case-c2" -type f 2>/dev/null)" ] && ok "other agent types write nothing" || bad "other agent types write nothing"

# 3. Hand-back delivery: last_assistant_message null, the block in a SubagentHandback.
TP="$ROOT/t3.jsonl"; transcript "$TP" "$PASS_MSG"
payload todo-verifier "" "$TP" | run_hook c3
[ "$(jq -r .verdict "$(rec c3)" 2>/dev/null)" = "pass" ] && ok "hand-back delivery writes a record" || bad "hand-back delivery writes a record"

# 3b. Same with a short wrapper as the delivered text (the async shape review-stamp-writer met).
payload todo-verifier "Verification complete and handed back." "$TP" | run_hook c3b
[ "$(jq -r .verdict "$(rec c3b)" 2>/dev/null)" = "pass" ] && ok "wrapper text falls back to the hand-back" || bad "wrapper text falls back to the hand-back"

# 4. Two hand-backs are ambiguous: write nothing.
TP="$ROOT/t4.jsonl"; transcript "$TP" "$FAIL_MSG" "$PASS_MSG"
payload todo-verifier "" "$TP" | run_hook c4
[ ! -e "$(rec c4)" ] && ok "two hand-backs write nothing" || bad "two hand-backs write nothing"

# 5. An abbreviated sha writes nothing (the reader looks records up by full commit sha).
payload todo-verifier "$(printf '%s' "$PASS_MSG" | sed "s/$SHA/1234567/")" | run_hook c5
[ -z "$(find "$ROOT/case-c5" -type f 2>/dev/null)" ] && ok "short sha writes nothing" || bad "short sha writes nothing"

# 6. The template echoed literally is not a verdict.
payload todo-verifier "$(reply 'pass | fail | none' 0 no)" | run_hook c6
[ ! -e "$(rec c6)" ] && ok "template verdict writes nothing" || bad "template verdict writes nothing"

# 7. Two VERDICT lines, or two VERIFIED-SHA lines, are ambiguous: write nothing.
payload todo-verifier "$PASS_MSG
VERDICT: fail" | run_hook c7
payload todo-verifier "$PASS_MSG
VERIFIED-SHA: feedfacefeedfacefeedfacefeedfacefeedface" | run_hook c7
[ -z "$(find "$ROOT/case-c7" -type f 2>/dev/null)" ] && ok "duplicate contract lines write nothing" || bad "duplicate contract lines write nothing"

# 8. A fail is never replaced by a later pass at the same sha.
payload todo-verifier "$FAIL_MSG" | run_hook c8
payload todo-verifier "$PASS_MSG" | run_hook c8
[ "$(jq -r .verdict "$(rec c8)" 2>/dev/null)" = "fail" ] && ok "pass does not overwrite fail" || bad "pass does not overwrite fail"

# 9. …while a fail does replace a pass.
payload todo-verifier "$PASS_MSG" | run_hook c9
payload todo-verifier "$FAIL_MSG" | run_hook c9
[ "$(jq -r .verdict "$(rec c9)" 2>/dev/null)" = "fail" ] && ok "fail overwrites pass" || bad "fail overwrites pass"

# 9b. A "pass" whose counts say not_met=1 is not passing, so a later clean pass cannot replace it.
payload todo-verifier "$(reply pass 1 no)" | run_hook c9b
payload todo-verifier "$PASS_MSG" | run_hook c9b
[ "$(jq -r .not_met "$(rec c9b)" 2>/dev/null)" = "1" ] && ok "inconsistent pass is kept over a later pass" || bad "inconsistent pass is kept over a later pass"

# 10. Missing COUNTS / CRITERIA_EDITED still records the verdict, with nulls (the reader holds).
payload todo-verifier "$(printf 'VERIFIED-SHA: %s\nVERDICT: pass\n' "$SHA")" | run_hook c10
f=$(rec c10)
[ "$(jq -r .verdict "$f" 2>/dev/null)" = "pass" ] && ok "verdict recorded without counts" || bad "verdict recorded without counts"
[ "$(jq -r '.not_met == null and .criteria_edited == null' "$f" 2>/dev/null)" = "true" ] \
  && ok "missing counts recorded as null" || bad "missing counts recorded as null"

# 11. CRLF line endings parse.
payload todo-verifier "$(printf '%s' "$PASS_MSG" | sed 's/$/\r/')" | run_hook c11
[ "$(jq -r .criteria_edited "$(rec c11)" 2>/dev/null)" = "no" ] && ok "CRLF reply parses" || bad "CRLF reply parses"

# 12. A hand-back that reaches the transcript after SubagentStop fired is still read.
TP="$ROOT/t12.jsonl"; transcript "$TP"
( sleep 1; jq -cn --arg b "$PASS_MSG" \
    '{type:"assistant", message:{content:[{type:"tool_use", name:"SubagentHandback", input:{message:$b}}]}}' >> "$TP" ) &
payload todo-verifier "" "$TP" | TODO_VERIFIER_HANDBACK_WAIT_SECS=3 run_hook c12
wait
[ "$(jq -r .verdict "$(rec c12)" 2>/dev/null)" = "pass" ] && ok "late hand-back is read" || bad "late hand-back is read"

# 13. Missing VERDICT writes nothing; unparseable input writes nothing; the hook always exits 0.
payload todo-verifier "$(printf 'VERIFIED-SHA: %s\n' "$SHA")" | run_hook c13
printf 'not json' | run_hook c13; rc=$?
[ -z "$(find "$ROOT/case-c13" -type f 2>/dev/null)" ] && ok "no verdict / bad input write nothing" || bad "no verdict / bad input write nothing"
[ "$rc" -eq 0 ] && ok "hook exits 0 on bad input" || bad "hook exits 0 on bad input"

# 14. A VERDICT outside the block's vocabulary writes nothing.
payload todo-verifier "$(reply maybe 0 no)" | run_hook c14
[ ! -e "$(rec c14)" ] && ok "unknown verdict writes nothing" || bad "unknown verdict writes nothing"

# 15. No temp file is left behind after a write.
[ -z "$(find "$ROOT/case-c1" -name '.tmp*' 2>/dev/null)" ] && ok "no temp file left behind" || bad "no temp file left behind"

EXPECTED_TOTAL=26
if [ $((PASS + FAIL)) -ne "$EXPECTED_TOTAL" ]; then
  echo "FAIL: assertion total is $((PASS + FAIL)), expected $EXPECTED_TOTAL — an assertion was skipped, or the total changed without updating this pin"
  FAIL=$((FAIL + 1))
fi
echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
