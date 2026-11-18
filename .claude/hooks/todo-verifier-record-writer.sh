#!/usr/bin/env bash
# SubagentStop — record the todo-verifier's verdict, from the verifier's OWN reply.
#
# Registered in .claude/settings.json with an agent_type matcher of `todo-verifier`. The /todo
# executor used to relay the verdict itself (todo-executor.md Step 10 step 5); now the record
# this hook writes is what scripts/verifier-record-status.sh reads, and
# scripts/todo-automerge-guard.sh HOLDs a PR whose governing record is missing or not a pass.
#
# Record: <review_stamp_dir VERIFIED-SHA>/verifier/todo-verifier.json. ONE LEVEL BELOW the
# reviewers' records on purpose: merge-review-guard.sh reads every *.json directly inside that
# directory and denies on any verdict other than clean/advisory, so a `pass` beside them would
# block merges. Any new reader of that directory must keep to depth 1, or skip `verifier/`.
#
# What this buys (same limits as review-stamp-writer.sh's header): the record is an unprotected
# JSON file at a derivable path, so an agent that DECIDES to forge one can. What it closes is the
# honest failure: an executor that misreads, skips or mis-relays the verdict, or a verifier that
# never ran, can no longer read as a pass.
#
# Every recorded field is the verifier's assertion; nothing is read from git for it. The one git
# call is review_stamp_dir's repo key, anchored to this script's repo (see the write step).
#
# Fail-silent: a missing tool or an unparseable reply exits 0 writing nothing. No record HOLDs
# the PR at the guard, so silence is the safe direction.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)

AGENT_TYPE=$(printf '%s' "$INPUT" | jq -r '.agent_type // empty' 2>/dev/null) || exit 0
# Allow-listed here as well as in the matcher: a matcher is configuration. The executor's
# general-purpose fallback dispatch must write no record, so its PR HOLDs.
[ "$AGENT_TYPE" = "todo-verifier" ] || exit 0

MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null) || MSG=""
TP=$(printf '%s' "$INPUT" | jq -r '.agent_transcript_path // empty' 2>/dev/null) || TP=""

has_contract() { grep -q '^VERIFIED-SHA:' <<<"$1"; }

# Where the block arrives. Measured on a real typed todo-verifier (2026-11-17): the transcript's
# last assistant entry is a SubagentHandback tool_use with no text at all, so the delivered text
# can be empty or a short wrapper. Read the hand-back then. Exactly one is required: two
# (a resumed verifier) is ambiguous and writes nothing. The wait covers a hand-back that reaches
# the transcript after this hook fired (review-stamp-writer.sh measured that race, 2026-10-30);
# bounded to stay inside the 10 s hook timeout.
if ! has_contract "$MSG" && [ -n "$TP" ] && [ -r "$TP" ]; then
  count_handbacks() {
    jq -rs '[.[] | select(.type=="assistant") | .message.content[]?
             | select(.type=="tool_use" and .name=="SubagentHandback")] | length' "$TP" 2>/dev/null || echo 0
  }
  WAIT=${TODO_VERIFIER_HANDBACK_WAIT_SECS:-5}
  case "$WAIT" in ''|*[!0-9]*) WAIT=5 ;; esac
  [ "$WAIT" -gt 8 ] && WAIT=8
  tries=$((WAIT * 4))
  NHB=$(count_handbacks)
  while [ "${NHB:-0}" -eq 0 ] && [ "$tries" -gt 0 ]; do
    sleep 0.25
    tries=$((tries - 1))
    NHB=$(count_handbacks)
  done
  if [ "${NHB:-0}" -eq 1 ]; then
    MSG=$(jq -rs '[.[] | select(.type=="assistant") | .message.content[]?
                   | select(.type=="tool_use" and .name=="SubagentHandback")]
                  | last | .input.message // empty' "$TP" 2>/dev/null) || MSG=""
  elif [ "${NHB:-0}" -eq 0 ] && [ -z "$MSG" ]; then
    MSG=$(jq -rs '[.[] | select(.type=="assistant")] | last | .message.content[]?
                  | select(.type=="text") | .text' "$TP" 2>/dev/null) || MSG=""
  else
    exit 0
  fi
fi
has_contract "$MSG" || exit 0
MSG=${MSG//$'\r'/}

# --- parse the block (.claude/agents/todo-verifier.md, "Reply") ---------------------------
# Each line must appear exactly once: a second VERDICT or VERIFIED-SHA makes the reply ambiguous.
once() { [ "$(grep -c "^$1:" <<<"$MSG")" -eq 1 ]; }
once VERIFIED-SHA && once VERDICT || exit 0

SHA=$(sed -n 's/^VERIFIED-SHA:[[:space:]]*\([0-9a-f]\{40\}\)[[:space:]]*$/\1/p' <<<"$MSG")
[ -n "$SHA" ] || exit 0   # a short sha files a record under a directory no reader opens
VERDICT=$(sed -nE 's/^VERDICT:[[:space:]]*(pass|fail|none)[[:space:]]*$/\1/p' <<<"$MSG")
[ -n "$VERDICT" ] || exit 0   # includes the template echoed as "pass | fail | none"

# COUNTS and CRITERIA_EDITED are recorded as null when absent or malformed; the reader treats
# null as not passing, so a fail without them is still recorded and still governs.
MET="" NOT_MET="" NEEDS="" MOVED="" EDITED="" TESTS=""
if once COUNTS; then
  C=$(sed -nE 's/^COUNTS:[[:space:]]*met=([0-9]+)[[:space:]]+not_met=([0-9]+)[[:space:]]+needs_person=([0-9]+)[[:space:]]+moved=([0-9]+)[[:space:]]*$/\1 \2 \3 \4/p' <<<"$MSG")
  [ -n "$C" ] && read -r MET NOT_MET NEEDS MOVED <<<"$C"
fi
once CRITERIA_EDITED && EDITED=$(sed -nE 's/^CRITERIA_EDITED:[[:space:]]*(yes|no)[[:space:]]*$/\1/p' <<<"$MSG")
once TEST_EDITS && TESTS=$(sed -n 's/^TEST_EDITS:[[:space:]]*//p' <<<"$MSG" | cut -c1-2000)

# --- write -------------------------------------------------------------------------------
case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
. "$HERE/lib/review-stamp-path.sh" 2>/dev/null || exit 0
declare -F review_stamp_dir >/dev/null || exit 0
# Anchored to this script's repo, not the verifier's cwd (review-stamp-writer.sh, write step).
BASE=$(cd "$HERE/../.." 2>/dev/null && review_stamp_dir "$SHA") || exit 0
[ -n "$BASE" ] || exit 0
DIR="$BASE/verifier"
mkdir -p "$DIR" 2>/dev/null || exit 0
OUT="$DIR/todo-verifier.json"

NEW=$(jq -n --arg sha "$SHA" --arg verdict "$VERDICT" \
  --arg met "$MET" --arg not_met "$NOT_MET" --arg needs "$NEEDS" --arg moved "$MOVED" \
  --arg edited "$EDITED" --arg tests "$TESTS" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  'def num: if . == "" then null else tonumber end;
   def str: if . == "" then null else . end;
   {head_sha: $sha, agent_type: "todo-verifier", verdict: $verdict,
    met: ($met|num), not_met: ($not_met|num), needs_person: ($needs|num), moved: ($moved|num),
    criteria_edited: ($edited|str), test_edits: ($tests|str),
    written_by: "todo-verifier-record-writer.sh", written_at: $at}') || exit 0

# The same predicate scripts/verifier-record-status.sh applies; keep the two equal.
PASSING='(.verdict == "pass" or .verdict == "none") and .not_met == 0 and .criteria_edited == "no"'
# A non-passing record is never replaced by a passing one at the same sha: a fix is a new
# commit, so a re-run that passes on the SAME commit is the verifier disagreeing with itself,
# and the earlier objection stands. An unreadable existing record counts as non-passing.
if [ -e "$OUT" ] && ! jq -e "$PASSING" "$OUT" >/dev/null 2>&1 \
   && jq -e "$PASSING" >/dev/null 2>&1 <<<"$NEW"; then
  exit 0
fi

# Temp file + rename, so a reader never sees a half-written record.
TMP=$(mktemp "$DIR/.tmp.XXXXXX" 2>/dev/null) || exit 0
printf '%s\n' "$NEW" > "$TMP" 2>/dev/null && mv -f "$TMP" "$OUT" 2>/dev/null || rm -f "$TMP"
exit 0
