#!/usr/bin/env bash
# Tests for review-stamp-writer.sh — run from project root. Hermetic: stdin JSON only,
# stamps land in a throwaway REVIEW_STAMP_ROOT. The hook must never invoke git.
set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HOOKS_DIR/review-stamp-writer.sh"
PASS=0; FAIL=0
ROOT=$(mktemp -d "/tmp/review-stamp-writer-test-$$-XXXX")
trap 'rm -rf "$ROOT"' EXIT

# An optional $1 names a PRIVATE stamp root under $ROOT. The hook now enforces the
# roster allow-list, so a fixture can no longer get its own stamp FILENAME by inventing
# an agent_type — it gets its own root instead and reuses a roster type. Callers that
# pass nothing share $ROOT, which is what case 2 ("two reviewers coexist under one SHA")
# and case 8 (deliberately overwriting case 1's file) depend on.
run_hook() {
  local root="$ROOT"
  [ $# -gt 0 ] && root="$ROOT/case-$1"
  REVIEW_STAMP_ROOT="$root" bash "$HOOK" >/dev/null 2>&1
}
case_stamp() {  # $1 = case name (its private root), $2 = agent type (default code-reviewer)
  printf '%s/case-%s/%s/%s.json' "$ROOT" "$1" "$SHA" "${2:-code-reviewer}"
}

ok()   { echo "PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

payload() {  # $1=agent_type  $2=last_assistant_message
  jq -n --arg t "$1" --arg m "$2" \
    '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t, last_assistant_message:$m}'
}

CLEAN_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts
client/hooks/__tests__/useNutritionLookup.test.ts

No findings.'

FINDINGS_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

[CRITICAL] client/hooks/useNutritionLookup.ts:42 — fabricates a basis
[SUGGESTION] client/hooks/useNutritionLookup.ts:88 — rename for clarity'

SHA=1234567890abcdef1234567890abcdef12345678

# 1. A clean review writes a stamp named for the agent type.
payload "code-reviewer" "$CLEAN_MSG" | run_hook
f="$ROOT/$SHA/code-reviewer.json"
[ -f "$f" ] && ok "clean review writes a stamp" || bad "clean review writes a stamp"
[ "$(jq -r .verdict "$f" 2>/dev/null)" = "clean" ] && ok "verdict clean" || bad "verdict clean"
[ "$(jq -r .head_sha "$f" 2>/dev/null)" = "$SHA" ] && ok "head_sha recorded" || bad "head_sha recorded"
[ "$(jq -r .agent_type "$f" 2>/dev/null)" = "code-reviewer" ] && ok "agent_type recorded" || bad "agent_type recorded"
[ "$(jq -r .written_by "$f" 2>/dev/null)" = "review-stamp-writer.sh" ] && ok "written_by recorded" || bad "written_by recorded"
# Digest pin — computed INDEPENDENTLY of the hook's own pipeline, not by trusting a value
# the hook itself produced: `printf '%s\n' "<sorted files>" | shasum | cut -c1-16` run
# directly against CLEAN_MSG's two files IN SORT ORDER — NOT the order CLEAN_MSG lists
# them in (it lists useNutritionLookup.ts first; `sort -u` puts __tests__/... first,
# since `_` 0x5F sorts before `u` 0x75). Re-deriving the pin from the fixture's literal
# listed order gives 2d3b4017ead64439, which is NOT this value and does not mean the pin
# is broken. Task 5
# must recompute this identically, so THIS is the assertion that catches a later edit
# silently dropping `sort -u` or swapping `shasum` for `shasum -a 256` — a verdict-only
# check cannot see either mutation (both leave verdict:clean untouched).
[ "$(jq -r .reviewed_files_digest "$f" 2>/dev/null)" = "cf5a596de517834a" ] \
  && ok "reviewed_files_digest matches the independently-computed formula (drift pin)" \
  || bad "reviewed_files_digest matches the independently-computed formula (drift pin)"

# 2. Parallel roster dispatch: a second reviewer coexists, never clobbers.
payload "server-reviewer" "$CLEAN_MSG" | run_hook
[ -f "$ROOT/$SHA/server-reviewer.json" ] && [ -f "$f" ] \
  && ok "two reviewers coexist under one SHA" || bad "two reviewers coexist under one SHA"

# 3. A bracketed CRITICAL finding is recorded in unresolved; a bracketed SUGGESTION is
#    not. (unresolved's full contents are wider than "CRITICAL findings only" — see the
#    hook's own comment above the jq block, and case 8 below for the widened shape.)
payload "mobile-reviewer" "$FINDINGS_MSG" | run_hook
g="$ROOT/$SHA/mobile-reviewer.json"
[ "$(jq -r .verdict "$g" 2>/dev/null)" = "findings" ] && ok "verdict findings" || bad "verdict findings"
[ "$(jq -r '.unresolved | length' "$g" 2>/dev/null)" = "1" ] \
  && ok "unresolved excludes the SUGGESTION-tagged line (bracketed-findings fixture; unresolved is not limited to CRITICAL-tagged lines in general — see case 8)" || bad "unresolved excludes the SUGGESTION-tagged line (bracketed-findings fixture; unresolved is not limited to CRITICAL-tagged lines in general — see case 8)"

# 4. Refusals — a stamp must certify executed work.
before=$(find "$ROOT" -name '*.json' | wc -l | tr -d ' ')
payload "code-reviewer" "No findings." | run_hook                       # no SHA block
payload "code-reviewer" "REVIEWED-SHA: $SHA"$'\n'"No findings." | run_hook  # no FILES block
payload "" "$CLEAN_MSG" | run_hook                                       # no agent_type
printf '%s' '{"hook_event_name":"SubagentStop"}' | run_hook              # empty payload
after=$(find "$ROOT" -name '*.json' | wc -l | tr -d ' ')
[ "$before" = "$after" ] && ok "malformed payloads write nothing" || bad "malformed payloads write nothing"

# 4b. ROSTER ALLOW-LIST — two-sided, from ONE fixture. Case 4 above covers only the EMPTY
#     agent_type, which the `[ -n "$AGENT_TYPE" ]` guard already rejected; it says nothing
#     about a well-formed, safely-named, NON-REVIEWER type. Measured before the fix:
#     `general-purpose` carrying this very message wrote {"verdict":"clean"} with a correct
#     digest, and the orchestrator chooses which subagent receives that message — spec §9
#     requires "a non-reviewer agent_type produces no stamp". Both sides use $CLEAN_MSG so
#     the agent type is the ONLY variable: a one-sided negative would pass just as happily
#     on a hook that had stopped writing stamps altogether.
payload "code-reviewer"   "$CLEAN_MSG" | run_hook roster-allow
payload "general-purpose" "$CLEAN_MSG" | run_hook roster-deny
[ -f "$(case_stamp roster-allow)" ] \
  && ok "roster agent_type still writes a stamp (allow-list control)" \
  || bad "roster agent_type still writes a stamp (allow-list control)"
# Checked by FIND, not by the one filename the hook would have chosen, so the assertion
# holds for any name a widened allow-list might produce.
[ -z "$(find "$ROOT/case-roster-deny" -name '*.json' 2>/dev/null)" ] \
  && ok "non-roster agent_type writes no stamp at all (spec §9)" \
  || bad "non-roster agent_type writes no stamp at all (spec §9)"

# 5. The hook itself must not invoke git DIRECTLY (it has no trustworthy cwd —
#    AI_WORKFLOW.md:40). It is not "no git anywhere in the write path": the sourced
#    review_stamp_dir runs `git rev-parse --git-common-dir` to derive the repo KEY, and is
#    explicitly anchored to this script's own directory where it is called. The grep below
#    only ever scanned $HOOK's own lines, so the check was always this narrower claim —
#    the LABEL was the stale part, and a reader taking it at face value would conclude no
#    git dependency exists in the write path at all. The anchored call is covered by the
#    REVIEW_STAMP_ROOT-unset assertions at the end of this file.
#    Strip comment lines FIRST: the hook's own header explains why `git rev-parse HEAD`
#    would be wrong here, and a naive grep matches that prose and fails on the explanation.
if grep -vE '^[[:space:]]*#' "$HOOK" | grep -qE '(^|[^a-z_])git '; then
  bad "hook must not invoke git directly (the one indirect call is anchored)"
else
  ok "hook does not invoke git directly (the one indirect call is anchored)"
fi

# --- Required widening: the five roster reviewer agent definitions each mandate their
# OWN findings format (`file:line — issue — concrete fix`, severity-tagged, no brackets)
# independent of the dispatch prompt's `[CRITICAL] ...` request. A reviewer following its
# own definition instead of the dispatch prompt must still be caught, or the writer
# fail-opens: parses a valid SHA/FILES block, finds no BRACKETED critical, records
# `verdict: clean` despite a real CRITICAL, and the later gate permits the merge.

# 6. AGENT-DEFINITION findings format (unbracketed, severity tag in a different position)
#    with a CRITICAL must still produce verdict:findings — the regression test for the
#    fail-open above. This is the mandatory case: without it the widening is unproven.
AGENT_DEF_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
server/routes/recipes.ts

server/routes/recipes.ts:118 — missing ownership check before update — add req.user.id equality filter (CRITICAL)'
payload "ai-reviewer" "$AGENT_DEF_MSG" | run_hook
h="$ROOT/$SHA/ai-reviewer.json"
[ "$(jq -r .verdict "$h" 2>/dev/null)" = "findings" ] \
  && ok "agent-definition CRITICAL rendering still produces verdict:findings" \
  || bad "agent-definition CRITICAL rendering still produces verdict:findings"

# 7. A REVIEWED-FILES entry whose PATH contains the word CRITICAL must not, by itself,
#    produce verdict:findings — content inside the files block is not a finding.
FILES_NAME_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/CRITICAL.ts

No findings.'
payload "security-auditor" "$FILES_NAME_MSG" | run_hook
i="$ROOT/$SHA/security-auditor.json"
[ "$(jq -r .verdict "$i" 2>/dev/null)" = "clean" ] \
  && ok "a CRITICAL-named path in REVIEWED-FILES does not by itself trigger findings" \
  || bad "a CRITICAL-named path in REVIEWED-FILES does not by itself trigger findings"

# 8. PINNED DIRECTION: a review whose prose merely MENTIONS the word CRITICAL (not a
#    bracketed or agent-definition finding line) also produces verdict:findings. This is
#    a deliberate over-detection choice, not an oversight — see the writer's own "when in
#    doubt, over-detect" comment. A false "findings" blocks a merge and a human unblocks
#    it; a false "clean" ships unreviewed code past the gate, so the writer errs toward
#    flagging ambiguous prose rather than parsing it away.
PROSE_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

No findings. No CRITICAL issues were found in this diff.'
payload "code-reviewer" "$PROSE_MSG" | run_hook   # reuses code-reviewer; case 1 already asserted
j="$ROOT/$SHA/code-reviewer.json"
[ "$(jq -r .verdict "$j" 2>/dev/null)" = "findings" ] \
  && ok "prose mentioning CRITICAL is over-detected as findings (pinned direction)" \
  || bad "prose mentioning CRITICAL is over-detected as findings (pinned direction)"
# `unresolved` is "every line that triggered the verdict", not "the bracketed CRITICAL
# findings" (that narrower reading was case 3's). Pin the shape here so it's explicit,
# not incidental: the prose sentence itself lands in `unresolved` verbatim.
[ "$(jq -r '.unresolved | length' "$j" 2>/dev/null)" = "1" ] \
  && [ "$(jq -r '.unresolved[0]' "$j" 2>/dev/null)" = "No findings. No CRITICAL issues were found in this diff." ] \
  && ok "unresolved holds the triggering prose line verbatim (widened semantics, pinned)" \
  || bad "unresolved holds the triggering prose line verbatim (widened semantics, pinned)"

# --- CRITICAL fix: verdict:clean must be a POSITIVE signal, never the absence of one ---
# docs/AI_WORKFLOW.md's contract: "If there are no issues, write exactly: No findings."
# A message with neither a matched CRITICAL nor that literal line is not a
# contract-compliant review and must write NO STAMP (gate denies), never a manufactured
# `clean`. Four ways a message can lack any matched signal without being a genuine clean
# review — none of these may find their way to the "else VERDICT=clean" branch anymore
# because that branch no longer exists; each must produce no stamp at all.

# 9a. Transcript truncation lands exactly at the header, since the contract puts
#     REVIEWED-SHA/REVIEWED-FILES FIRST — the findings section is simply absent.
NO_SIGNAL_TRUNCATED='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts'

# 9b. A markdown heading instead of a severity tag — untagged finding line underneath.
NO_SIGNAL_HEADING='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
server/routes/recipes.ts

### Critical
server/routes/recipes.ts:118 — missing ownership check'

# 9c. Bold markdown instead of a bracketed/uppercase severity tag.
NO_SIGNAL_BOLD='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
server/routes/recipes.ts

**Critical** server/routes/recipes.ts:118 — missing check'

# 9d. The dangerous row: a bracketed [WARNING] correctly terminates the FILES parse (the
#     digest is right), but the real finding is mis-cased ("Critical:") and unmatched —
#     nothing downstream (a digest check) can catch this one.
NO_SIGNAL_WARNING_THEN_MISCASED='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
server/routes/recipes.ts

[WARNING] server/routes/recipes.ts:10 — nit
Critical: server/routes/recipes.ts:118 — missing check'

payload "code-reviewer" "$NO_SIGNAL_TRUNCATED" | run_hook nosignal-a
payload "code-reviewer" "$NO_SIGNAL_HEADING" | run_hook nosignal-b
payload "code-reviewer" "$NO_SIGNAL_BOLD" | run_hook nosignal-c
payload "code-reviewer" "$NO_SIGNAL_WARNING_THEN_MISCASED" | run_hook nosignal-d
[ ! -f "$(case_stamp nosignal-a)" ] && ok "truncated-at-header writes no stamp" || bad "truncated-at-header writes no stamp"
[ ! -f "$(case_stamp nosignal-b)" ] && ok "markdown-heading (untagged) writes no stamp" || bad "markdown-heading (untagged) writes no stamp"
[ ! -f "$(case_stamp nosignal-c)" ] && ok "bold-markdown (untagged) writes no stamp" || bad "bold-markdown (untagged) writes no stamp"
[ ! -f "$(case_stamp nosignal-d)" ] && ok "[WARNING]-then-miscased-CRITICAL writes no stamp (digest was correct; verdict was not)" || bad "[WARNING]-then-miscased-CRITICAL writes no stamp (digest was correct; verdict was not)"

# 9e/9f. Both controls, re-asserted in this section's own context so the fix is proven
# against fresh fixtures, not just inherited from cases 1/3/6 above.
CONTROL_CRITICAL_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
server/routes/recipes.ts

[CRITICAL] server/routes/recipes.ts:118 — missing check'
CONTROL_CLEAN_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
server/routes/recipes.ts

No findings.'
payload "code-reviewer" "$CONTROL_CRITICAL_MSG" | run_hook nosignal-control-critical
payload "code-reviewer" "$CONTROL_CLEAN_MSG" | run_hook nosignal-control-clean
k="$(case_stamp nosignal-control-critical)"
l="$(case_stamp nosignal-control-clean)"
[ "$(jq -r .verdict "$k" 2>/dev/null)" = "findings" ] \
  && ok "control: a real [CRITICAL] still produces verdict:findings" \
  || bad "control: a real [CRITICAL] still produces verdict:findings"
[ "$(jq -r .verdict "$l" 2>/dev/null)" = "clean" ] \
  && ok "control: literal 'No findings.' still produces verdict:clean" \
  || bad "control: literal 'No findings.' still produces verdict:clean"

# --- Round 2: fail-open with a CORRECT digest, via a stray "No findings." not at the
# end of the message. Both require the message to contain a genuine unmatched finding
# PLUS a standalone "No findings." line somewhere that is NOT the message's true
# conclusion (e.g. a reviewer quoting the contract while reviewing this hook or
# docs/AI_WORKFLOW.md writes exactly that). Fix (a) anchors the clean signal to the LAST
# non-empty line; fix (b) makes a bare bracketed severity tag alone on its own line count.

# 10. Mis-cased finding after a bracketed [SUGGESTION] (which correctly terminates the
#     FILES parse — digest is right) plus a stray mid-message "No findings." that is NOT
#     the last line. Neither fix (a) nor (b) can make "Critical:" match (case-sensitive,
#     by design) — this fixture is closed by (a) ALONE: the true last line is prose, not
#     the literal, so it falls through to "no findings section -> write nothing".
ROUND2_MISCASED_STRAY_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
server/routes/recipes.ts

[SUGGESTION] server/routes/recipes.ts:10 — nit
Critical: server/routes/recipes.ts:118 — missing check

No findings.

(quoting the contract'"'"'s exact wording above while explaining my format)'
payload "code-reviewer" "$ROUND2_MISCASED_STRAY_MSG" | run_hook round2-miscased-stray
[ ! -f "$(case_stamp round2-miscased-stray)" ] \
  && ok "mis-cased finding + stray mid-message 'No findings.' writes no stamp (fix a)" \
  || bad "mis-cased finding + stray mid-message 'No findings.' writes no stamp (fix a)"

# 11. A bare `[CRITICAL]` alone on its own line (no whitespace, no :digit — the shape
#     stage-2 was dropping) with the finding text on the NEXT line carrying no CRITICAL
#     token, plus the same stray mid-message "No findings.". This one is closed by fix
#     (b), not (a): the bracket-only line now survives stage 2 and CRITICALS is non-empty,
#     so VERDICT=findings is decided BEFORE the last-line check ever runs — a real,
#     evidenced stamp is written, which is the correct and safer outcome (not merely an
#     absent record). See the round-2 report for why this is asserted as verdict:findings
#     rather than "no stamp" despite the review's summary phrasing.
ROUND2_BARE_BRACKET_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
server/routes/recipes.ts

[CRITICAL]
server/routes/recipes.ts:118 — missing ownership check

No findings.

(quoting the contract'"'"'s exact wording above)'
payload "code-reviewer" "$ROUND2_BARE_BRACKET_MSG" | run_hook round2-bare-bracket
m="$(case_stamp round2-bare-bracket)"
[ "$(jq -r .verdict "$m" 2>/dev/null)" = "findings" ] \
  && ok "bare [CRITICAL] alone on its line now counts as a finding (fix b)" \
  || bad "bare [CRITICAL] alone on its line now counts as a finding (fix b)"
[ "$(jq -r '.unresolved | length' "$m" 2>/dev/null)" = "1" ] \
  && [ "$(jq -r '.unresolved[0]' "$m" 2>/dev/null)" = "[CRITICAL]" ] \
  && ok "unresolved records the bare bracket line itself" \
  || bad "unresolved records the bare bracket line itself"

# (Both pre-round-2 controls — case 9e/9f, `$k`/`$l` above — already run against this same
# hook file in this same suite execution, so they already prove the round-2 changes leave
# both green; re-checking the identical, unchanged `$k`/`$l` files here would be a vacuous
# duplicate assertion, not an independent one, so it's deliberately not repeated.)

# --- Round 3: fix (a) (the last-line anchor) introduced a NEW false-deny surface for a
# genuinely clean review. (a2) closes the same-line trailing-whitespace/CR sub-case; the
# roster fixture (13) proves the CRITICAL regression itself — the always-dispatched
# baseline reviewer's own mandated "patterns list, then No findings." shape — is fixed.
#
# --- Round 4: every fixture below asserts the DIGEST as well as the verdict. Round 3
# shipped all three of them verdict-only, and that is exactly how its own CRITICAL fix
# regressed the other axis: the mandated patterns list, the trailing spaces and the CR all
# sat INSIDE the REVIEWED-FILES block as far as the $FILES collector was concerned, so
# each fixture recorded verdict:clean while digesting text that is not a path — a record
# that passes on verdict and is denied by Task 5's gate on scope. Measured on the round-3
# hook: 14 -> 55fda4e16ce87ade, 12 -> a695238830846132, 13 -> c4a178fc2d2c517b, against a
# correct 8f4842be754477ff for the single path all three list. A verdict-only assertion
# cannot see any of that, which is the whole reason these pins exist.
#
# The pinned value is computed INDEPENDENTLY of the hook, by the same formula the task-5
# gate uses on the real PR diff (task-5-brief.md:283 —
# `... --name-only | sed '/^$/d' | sort -u | shasum | cut -c1-16`):
#     $ printf '%s\n' 'client/hooks/useNutritionLookup.ts' | shasum | cut -c1-16
#     8f4842be754477ff

# 12. Trailing spaces on the SAME line as the literal (an editor/renderer artifact) must
#     not defeat the exact-match comparison.
TRAILING_WS_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

No findings.   '
payload "code-reviewer" "$TRAILING_WS_MSG" | run_hook round3-trailing-ws
[ "$(jq -r .verdict "$(case_stamp round3-trailing-ws)" 2>/dev/null)" = "clean" ] \
  && ok "trailing whitespace after the literal does not defeat verdict:clean (fix a2)" \
  || bad "trailing whitespace after the literal does not defeat verdict:clean (fix a2)"
[ "$(jq -r .reviewed_files_digest "$(case_stamp round3-trailing-ws)" 2>/dev/null)" = "8f4842be754477ff" ] \
  && ok "trailing whitespace after the literal does not corrupt the digest (round 4)" \
  || bad "trailing whitespace after the literal does not corrupt the digest (round 4)"

# 13. A trailing CR (CRLF line ending) on the literal's own line must not defeat it either.
CRLF_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

No findings.'$'\r'
payload "code-reviewer" "$CRLF_MSG" | run_hook round3-crlf
[ "$(jq -r .verdict "$(case_stamp round3-crlf)" 2>/dev/null)" = "clean" ] \
  && ok "a trailing CR on the literal's line does not defeat verdict:clean (fix a2)" \
  || bad "a trailing CR on the literal's line does not defeat verdict:clean (fix a2)"
[ "$(jq -r .reviewed_files_digest "$(case_stamp round3-crlf)" 2>/dev/null)" = "8f4842be754477ff" ] \
  && ok "a trailing CR does not leave a CR inside the digested file list (round 4)" \
  || bad "a trailing CR does not leave a CR inside the digested file list (round 4)"

# 14. THE CRITICAL REGRESSION FIXTURE: a roster-shaped clean review whose "Report" step
#     (docs/AI_WORKFLOW.md -> .claude/agents/code-reviewer.md, both amended this round)
#     places the correctly-implemented-patterns list ABOVE "No findings.", not below it.
#     Every pre-round-3 clean fixture (CLEAN_MSG, FILES_NAME_MSG, CONTROL_CLEAN_MSG) goes
#     straight from the files block to "No findings." with nothing in between — none of
#     them exercised a message where real content precedes the final literal. This is
#     exactly the shape the always-dispatched baseline reviewer produces on every clean
#     review; before this round it was measured to write NO STAMP (gate denies every
#     clean merge).
ROSTER_CLEAN_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

Correctly-implemented patterns:
- Uses the shared cache-first pattern via fireAndForget for non-critical writes
- Validates input with the existing Zod schema before use

No findings.'
payload "code-reviewer" "$ROSTER_CLEAN_MSG" | run_hook round3-roster-clean
[ "$(jq -r .verdict "$(case_stamp round3-roster-clean)" 2>/dev/null)" = "clean" ] \
  && ok "roster-shaped clean review (patterns list ABOVE the final literal) produces verdict:clean" \
  || bad "roster-shaped clean review (patterns list ABOVE the final literal) produces verdict:clean"
# THE ROUND-4 CRITICAL, pinned: the same fixture that proves the verdict axis was, on the
# round-3 hook, digesting "Correctly-implemented patterns:" and both bullet lines as
# changed-file paths (55fda4e16ce87ade). Verdict green, scope denied.
[ "$(jq -r .reviewed_files_digest "$(case_stamp round3-roster-clean)" 2>/dev/null)" = "8f4842be754477ff" ] \
  && ok "the mandated patterns list is NOT digested as changed-file paths (round 4 CRITICAL)" \
  || bad "the mandated patterns list is NOT digested as changed-file paths (round 4 CRITICAL)"

# 15. A message that is CRLF THROUGHOUT and ends with a blank line. Distinct from 13 (one
#     trailing CR on the literal's line only): here the deciding failure is upstream of
#     both the verdict comparison and the file block. `awk 'NF{last=$0}'` counts a CR-ONLY
#     line as NON-EMPTY, so the last non-empty line is a bare "\r", the literal is never
#     compared, and the round-3 hook wrote NO STAMP at all for a genuinely clean review
#     (measured). Nothing in the suite exercised a CR anywhere but the final line, so the
#     ingest-level normalization has no other test that can fail if it is removed.
CRLF_FULL_MSG=$(printf 'REVIEWED-SHA: %s\r\nREVIEWED-FILES:\r\nclient/hooks/useNutritionLookup.ts\r\n\r\nNo findings.\r\n\r\n' "$SHA")
payload "code-reviewer" "$CRLF_FULL_MSG" | run_hook round4-crlf-full
n="$(case_stamp round4-crlf-full)"
[ -f "$n" ] && ok "an all-CRLF clean review with a trailing blank line writes a stamp at all (round 4)" \
  || bad "an all-CRLF clean review with a trailing blank line writes a stamp at all (round 4)"
[ "$(jq -r .verdict "$n" 2>/dev/null)" = "clean" ] \
  && ok "an all-CRLF clean review produces verdict:clean (round 4)" \
  || bad "an all-CRLF clean review produces verdict:clean (round 4)"
[ "$(jq -r .reviewed_files_digest "$n" 2>/dev/null)" = "8f4842be754477ff" ] \
  && ok "an all-CRLF clean review digests the path without its CR (round 4)" \
  || bad "an all-CRLF clean review digests the path without its CR (round 4)"

# 16. The shape a real roster review actually produces: MORE THAN ONE reviewed file AND
#     the mandated patterns list. 14 has the list but a single path, so nothing yet
#     exercises `sort -u` together with the new block terminator — a terminator that fired
#     one line too early would silently drop the second path and still look like a
#     plausible digest. Pinned to case 1's value ON PURPOSE: same two files, same sort
#     order, so adding a patterns list must be a no-op on the digest. (cf5a596de517834a is
#     computed in case 1's comment from the SORTED pair, not the listed order.)
ROSTER_MULTI_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts
client/hooks/__tests__/useNutritionLookup.test.ts

Correctly-implemented patterns:
- Test file co-located under __tests__/ per the project convention
- Zod-validated input at the boundary

No findings.'
payload "code-reviewer" "$ROSTER_MULTI_MSG" | run_hook round4-roster-multi
o="$(case_stamp round4-roster-multi)"
[ "$(jq -r .verdict "$o" 2>/dev/null)" = "clean" ] \
  && ok "multi-file roster-shaped clean review produces verdict:clean (round 4)" \
  || bad "multi-file roster-shaped clean review produces verdict:clean (round 4)"
[ "$(jq -r .reviewed_files_digest "$o" 2>/dev/null)" = "cf5a596de517834a" ] \
  && ok "a patterns list is a no-op on a MULTI-file digest — identical to case 1 (round 4)" \
  || bad "a patterns list is a no-op on a MULTI-file digest — identical to case 1 (round 4)"

# --- Round 5: the whitespace terminator added in round 4 fired on a WHITESPACE-ONLY line,
# which the pre-existing NF test had always treated as a skippable blank. Every separator
# in every fixture above is TRULY empty, so nothing in this file could see it.

# 17. A stray space (and, separately, a tab) on the separator line BETWEEN two listed
#     paths. The reviewer contract does not forbid blank lines inside the block and says
#     nothing about their byte content, so this is a shape a compliant reviewer can emit.
#     Round 4 truncated the block at the first path and digested a strict PREFIX of the
#     reviewed files — verdict clean, 8f4842be754477ff, where the two files digest to
#     cf5a596de517834a. Pinned with an EMPTY-separator control so a fixture that stopped
#     discriminating (e.g. if the second path were ever dropped from both) shows up as
#     both rows agreeing on the wrong value rather than silently passing.
ws_sep_msg() {  # $1 = the separator line's exact content
  printf 'REVIEWED-SHA: %s\nREVIEWED-FILES:\nclient/hooks/useNutritionLookup.ts\n%s\nclient/hooks/__tests__/useNutritionLookup.test.ts\n\nNo findings.\n' "$SHA" "$1"
}
payload "code-reviewer" "$(ws_sep_msg ' ')"  | run_hook round5-sep-space
payload "code-reviewer"   "$(ws_sep_msg "$(printf '\t')")" | run_hook round5-sep-tab
payload "code-reviewer" "$(ws_sep_msg '')"   | run_hook round5-sep-empty
for sep in space tab empty; do
  sf="$(case_stamp "round5-sep-$sep")"
  [ "$(jq -r .verdict "$sf" 2>/dev/null)" = "clean" ] \
    && ok "whitespace-separated file list ($sep) produces verdict:clean (round 5)" \
    || bad "whitespace-separated file list ($sep) produces verdict:clean (round 5)"
  [ "$(jq -r .reviewed_files_digest "$sf" 2>/dev/null)" = "cf5a596de517834a" ] \
    && ok "a $sep separator does not truncate the digested file list (round 5)" \
    || bad "a $sep separator does not truncate the digested file list (round 5)"
done

# --- the REVIEWED-SHA length bound -----------------------------------------------------
# Every fixture above uses the same full 40-character literal and no assertion names a
# length, so restoring the old `\{7,40\}` bound was invisible to this suite — measured
# byte-identical output on the unmutated and reverted copies. Two-sided: the abbreviated
# form must write NOTHING (it would otherwise file under a directory the reader never
# opens, making an objection invisible), and the full form must still write, so the row
# cannot pass on a writer that has stopped writing altogether.
SHORT_MSG='REVIEWED-SHA: 1234567
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

[CRITICAL] client/hooks/useNutritionLookup.ts:42 — fabricates a basis'
payload "security-auditor" "$SHORT_MSG" | run_hook sha-short
[ -z "$(find "$ROOT/case-sha-short" -name '*.json' 2>/dev/null)" ] \
  && ok "an abbreviated REVIEWED-SHA writes no record at all" \
  || bad "an abbreviated REVIEWED-SHA writes no record at all"
payload "security-auditor" "$FINDINGS_MSG" | run_hook sha-full
[ -n "$(find "$ROOT/case-sha-full" -name '*.json' 2>/dev/null)" ] \
  && ok "control: a full 40-char REVIEWED-SHA still writes one" \
  || bad "control: a full 40-char REVIEWED-SHA still writes one"

# --- the ANCHORED path, which every assertion above skips -------------------------------
# Every case above sets REVIEW_STAMP_ROOT, and review_stamp_dir returns on that before it
# ever reaches `git rev-parse --git-common-dir` (lib/review-stamp-path.sh:26-29). So the
# git-dependent branch — the one the anchoring fix is about — had NO coverage: reverting
# the `cd "$HERE/../.."` subshell passed the whole suite, and the only symptom would have
# been records filed under a `-global-` key that merge-review-guard.sh never reads, i.e. a
# clean review denying as "no record".
#
# Runs with REVIEW_STAMP_ROOT UNSET and cwd deliberately outside the repo, which is the
# dispatched reviewer's real situation. A unique SHA keeps it out of any real stamp dir.
ANCHOR_SHA=$(printf 'a%039d' $$ | cut -c1-40)
ANCHOR_MSG="REVIEWED-SHA: $ANCHOR_SHA
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

No findings."
ANCHOR_EXPECT=$(cd "$HOOKS_DIR/../.." && . "$HOOKS_DIR/lib/review-stamp-path.sh" && review_stamp_dir "$ANCHOR_SHA" 2>/dev/null)
ANCHOR_GLOBAL="/tmp/ocrecipes-review-stamps-global/$ANCHOR_SHA"
if [ -n "$ANCHOR_EXPECT" ] && [ "$ANCHOR_EXPECT" != "$ANCHOR_GLOBAL" ]; then
  ( cd /tmp && payload "code-reviewer" "$ANCHOR_MSG" | env -u REVIEW_STAMP_ROOT bash "$HOOK" >/dev/null 2>&1 )
  [ -f "$ANCHOR_EXPECT/code-reviewer.json" ] \
    && ok "unset REVIEW_STAMP_ROOT from a foreign cwd still keys by THIS repo" \
    || bad "unset REVIEW_STAMP_ROOT from a foreign cwd still keys by THIS repo"
  # The negative half: the pre-fix behaviour filed here, so its absence is the signal.
  [ ! -f "$ANCHOR_GLOBAL/code-reviewer.json" ] \
    && ok "no stamp lands under the shared -global- key" \
    || bad "no stamp lands under the shared -global- key"
  rm -rf "$ANCHOR_EXPECT" "$ANCHOR_GLOBAL" 2>/dev/null
else
  # Not a silent skip: if the control cannot be built, say so and fail.
  bad "anchoring fixture is usable (expected=[$ANCHOR_EXPECT])"
fi

# --- ASYNC (background) dispatch shape ---------------------------------------
# A subagent dispatched in the background does not deliver its report as the final
# assistant TEXT. The report travels inside a SubagentHandback tool_use, and
# last_assistant_message carries only a wrapper line. Measured 2026-09-14: a real
# async server-reviewer returned a correctly-formatted clean review for
# 793a06b8e43c08e0ba19490eba571167be76e57f and NO stamp was written — the wrapper line
# is NON-EMPTY, so the pre-existing `[ -z "$MSG" ]` transcript fallback never fires,
# and the wrapper carries no REVIEWED-SHA. Both halves have to be true for the bug;
# testing only "transcript fallback works" would miss it.
WRAPPER_LINE="Review complete and handed back to the caller."

async_transcript() {  # $1=report text -> prints a transcript path
  local tp; tp=$(mktemp "$ROOT/transcript-XXXX")
  jq -nc --arg m "$1" '{type:"assistant", message:{content:[
      {type:"tool_use", name:"SubagentHandback", input:{message:$m}}]}}' >"$tp"
  jq -nc --arg w "$WRAPPER_LINE" '{type:"assistant", message:{content:[
      {type:"text", text:$w}]}}' >>"$tp"
  printf '%s\n' "$tp"
}
async_payload() {  # $1=agent_type $2=transcript path
  jq -n --arg t "$1" --arg p "$2" --arg w "$WRAPPER_LINE" \
    '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
      last_assistant_message:$w, agent_transcript_path:$p}'
}

async_payload "code-reviewer" "$(async_transcript "$CLEAN_MSG")" | run_hook 20
af="$ROOT/case-20/$SHA/code-reviewer.json"
[ -f "$af" ] && ok "async SubagentHandback report writes a stamp" \
             || bad "async SubagentHandback report writes a stamp"
[ "$(jq -r .head_sha "$af" 2>/dev/null)" = "$SHA" ] \
  && ok "async stamp records the reviewed sha" || bad "async stamp records the reviewed sha"
[ "$(jq -r .verdict "$af" 2>/dev/null)" = "clean" ] \
  && ok "async stamp records the clean verdict" || bad "async stamp records the clean verdict"
# Same digest pin as case 1: the async path must produce a record INDISTINGUISHABLE from
# the sync path for the same report, not merely a record that exists.
[ "$(jq -r .reviewed_files_digest "$af" 2>/dev/null)" = "cf5a596de517834a" ] \
  && ok "async stamp digest equals the sync digest for the same report" \
  || bad "async stamp digest equals the sync digest for the same report"

# CONTROL (negative): identical async envelope, transcript carrying NO handback — only the
# wrapper text. There is nothing to parse, so there must be NO stamp. Without this, the
# positive above would also pass a hook that blindly stamped every async envelope.
NOHB_TP=$(mktemp "$ROOT/transcript-nohb-XXXX")
jq -nc --arg w "$WRAPPER_LINE" '{type:"assistant", message:{content:[
    {type:"text", text:$w}]}}' >"$NOHB_TP"
async_payload "code-reviewer" "$NOHB_TP" | run_hook 21
[ ! -f "$ROOT/case-21/$SHA/code-reviewer.json" ] \
  && ok "async envelope with no handback writes no stamp" \
  || bad "async envelope with no handback writes no stamp"

# CONTROL (precedence): when last_assistant_message ALREADY carries the contract (the
# synchronous shape), it is what gets parsed. A transcript handback for a DIFFERENT head must
# not override a valid direct report — otherwise a fix could silently re-route the sync path
# through the transcript and this suite's other assertions would stop covering it.
# RE-PINNED 2026-09-22, and the flip is the point: this control used to pair the direct clean
# report with a FINDINGS handback and assert that the direct report won. That pairing is the
# laundering shape guard (c) now refuses — an objection anywhere in the transcript plus a clean
# contract in the text writes nothing (case 37 holds that exact fixture with the opposite
# verdict). The precedence property survives with a handback that carries no objection: a
# clean report for ANOTHER head. The record must land at the direct report's sha, and nothing
# may land at the handback's.
OTHER_CLEAN_MSG=${CLEAN_MSG/1234567890abcdef1234567890abcdef12345678/feedfacefeedfacefeedfacefeedfacefeedface}
MIXED_TP=$(async_transcript "$OTHER_CLEAN_MSG")
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$MIXED_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 22
[ "$(jq -r .verdict "$ROOT/case-22/$SHA/code-reviewer.json" 2>/dev/null)" = "clean" ] \
  && [ ! -f "$ROOT/case-22/feedfacefeedfacefeedfacefeedfacefeedface/code-reviewer.json" ] \
  && ok "a direct report still wins over a clean transcript handback for another head" \
  || bad "a direct report still wins over a clean transcript handback for another head"

# --- the substitution must not manufacture consent the reviewer withheld ----------------
# The transcript probe fires precisely BECAUSE the delivered message lacks the contract —
# which is also the condition under which the contract says to write NOTHING. So the
# trigger needs a floor. Both cases below were constructed against the live hook during
# review and both wrote a clean stamp before the guards were added.

# Case 23. The delivered text is not a wrapper at all: it is a substantive report opening
# with a bracketed finding and explicitly declining to certify. An earlier clean handback
# must NOT be substituted over it.
OBJECTION_MSG='[CRITICAL] .claude/hooks/review-stamp-writer.sh:74 — the fallback manufactures consent.
I am deliberately withholding the contract trailer so that no review record is written.'
OBJ_TP=$(async_transcript "$CLEAN_MSG")
jq -n --arg t "code-reviewer" --arg m "$OBJECTION_MSG" --arg p "$OBJ_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 23
[ ! -f "$ROOT/case-23/$SHA/code-reviewer.json" ] \
  && ok "a bracketed objection in the delivered text blocks the substitution" \
  || bad "a bracketed objection in the delivered text blocks the substitution"
# CONTROL for case 23, and it is load-bearing: feed the SAME transcript with an ordinary
# wrapper line. It must stamp. Without this, case 23 would also pass if the transcript were
# simply unreadable — a no-stamp result proves nothing unless the same input can stamp.
async_payload "code-reviewer" "$OBJ_TP" | run_hook 24
[ -f "$ROOT/case-24/$SHA/code-reviewer.json" ] \
  && ok "the same transcript still stamps behind an ordinary wrapper line" \
  || bad "the same transcript still stamps behind an ordinary wrapper line"

# Case 25. Two handbacks, findings first then clean. `last` would take the clean one and
# drop the objection; the drop direction is the unsafe one and nothing enforces
# one-handback-per-agent, so an ambiguous transcript must write nothing.
TWOHB_TP=$(mktemp "$ROOT/transcript-twohb-XXXX")
jq -nc --arg m "$FINDINGS_MSG" '{type:"assistant", message:{content:[
    {type:"tool_use", name:"SubagentHandback", input:{message:$m}}]}}' >"$TWOHB_TP"
jq -nc --arg m "$CLEAN_MSG" '{type:"assistant", message:{content:[
    {type:"tool_use", name:"SubagentHandback", input:{message:$m}}]}}' >>"$TWOHB_TP"
jq -nc --arg w "$WRAPPER_LINE" '{type:"assistant", message:{content:[
    {type:"text", text:$w}]}}' >>"$TWOHB_TP"
async_payload "code-reviewer" "$TWOHB_TP" | run_hook 25
[ ! -f "$ROOT/case-25/$SHA/code-reviewer.json" ] \
  && ok "two handbacks are ambiguous and write no stamp" \
  || bad "two handbacks are ambiguous and write no stamp"
# CONTROL for case 25: the SECOND handback alone — the one `last` would have chosen — is
# perfectly stampable. So case 25's silence is caused by the ambiguity, not by the content.
async_payload "code-reviewer" "$(async_transcript "$CLEAN_MSG")" | run_hook 26
[ -f "$ROOT/case-26/$SHA/code-reviewer.json" ] \
  && ok "that same clean handback alone does stamp" \
  || bad "that same clean handback alone does stamp"

# --- the objection guard must honour the rendering the ROSTER mandates -------------------
# Case 23 covers `[CRITICAL]` at column 0, which is what docs/AI_WORKFLOW.md's dispatch
# prompt asks for. But every agent definition mandates the UNBRACKETED
# `file:line — issue — concrete fix` tagged with a bare severity word, and the first
# version of this guard honoured only the bracketed form: measured, four of five objection
# shapes wrote `verdict: clean` over a real objection. Each row below is a shape a roster
# reviewer actually produces, paired with the same clean handback as case 23.
objection_case() {  # $1 = case id, $2 = delivered message, $3 = assertion label
  local tp; tp=$(async_transcript "$CLEAN_MSG")
  jq -n --arg t "code-reviewer" --arg m "$2" --arg p "$tp" \
    '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
      last_assistant_message:$m, agent_transcript_path:$p}' | run_hook "$1"
  [ ! -f "$ROOT/case-$1/$SHA/code-reviewer.json" ] && ok "$3" || bad "$3"
}
objection_case 27 'client/a.ts:74 — missing check — add it. CRITICAL
Withholding the trailer deliberately.' \
  "the roster-mandated file:line rendering blocks the substitution"
objection_case 28 'CRITICAL — client/a.ts:74 — missing check — add it
Withholding the trailer deliberately.' \
  "a leading bare severity word with a citation blocks the substitution"
objection_case 29 '  [CRITICAL] client/a.ts:74 — missing check' \
  "an indented bracketed finding blocks the substitution"
objection_case 30 '- [CRITICAL] client/a.ts:74 — missing check' \
  "a bulleted bracketed finding blocks the substitution"
# Case 31 asserts the OPPOSITE of what an earlier revision pinned, and the reason is worth
# stating precisely because an earlier version of THIS comment got it wrong. It used to
# require that "Review complete: no CRITICAL or WARNING findings" still stamps. Pinning
# that as must-stamp is what forced arm 2 to demand a `:<digit>` citation, and that demand
# is what let a citation-free REFUSAL through (case 34) — a fail-open on the merge gate.
#
# The justification is NOT that the contract forbids this phrasing "because $CRITICALS
# over-detects it": $CRITICALS never sees this message at all, and the outcome asserted
# below is NO RECORD, not a `findings` record. What actually justifies it is parity — the
# SYNC path records `findings` for this same sentence via $CRITICALS, so before the flip
# the async path was strictly more permissive than sync for one shape. The flip removes
# that asymmetry. The cost is a re-dispatch for a reviewer who has not read the agent
# definition; residual 6 in the hook carries it. Contract-compliant clean wrapper: case 33.
CLEAN_PROSE_TP=$(async_transcript "$CLEAN_MSG")
jq -n --arg t "code-reviewer" --arg p "$CLEAN_PROSE_TP" \
  --arg m 'Review complete: no CRITICAL or WARNING findings in this diff.' \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 31
[ ! -f "$ROOT/case-31/$SHA/code-reviewer.json" ] \
  && ok "prose using a forbidden severity word is treated as an objection (contract: write 'no blocking issues')" \
  || bad "prose using a forbidden severity word is treated as an objection (contract: write 'no blocking issues')"

# Case 34 — the CRITICAL that the citation requirement let through. A refusal carries no
# file:line by its nature, so requiring one made arm 2 blind to exactly the shape the guard
# exists for. Measured before this fix: stamp written with verdict `clean`, unresolved 0,
# digest matching, and merge-review-guard ALLOWED the merge over an explicit refusal.
objection_case 34 'CRITICAL: this fallback manufactures consent.
Withholding the contract trailer deliberately so that NO review record is written.' \
  "a citation-free refusal blocks the substitution"
# Case 35 — arm 1 is case-insensitive here because a miss at THIS site is fail-OPEN, which
# inverts residual 4 (that rationale governs the fail-CLOSED $CRITICALS site).
objection_case 35 '[critical] client/a.ts:74 — withholding deliberately.' \
  "a lowercase bracketed tag blocks the substitution (arm 1 is case-insensitive)"

# RESIDUAL 6, pinned as a KNOWN-WRONG row rather than left undocumented. Both guard arms
# match per LINE (grep anchors `^` at every line start of a herestring), so a genuinely
# clean wrapper that QUOTES the contract on a later line writes no stamp. This assertion
# records the current behaviour deliberately: if someone narrows the guard to the first
# non-empty line, this row flips and they are forced to read residual 6 and re-derive
# which direction is cheaper, instead of silently reopening the manufactured-consent hole.
QUOTE_TP=$(async_transcript "$CLEAN_MSG")
jq -n --arg t "code-reviewer" --arg p "$QUOTE_TP" \
  --arg m 'Review complete and handed back to the caller.
[CRITICAL]/[WARNING]/[SUGGESTION] tags are used for findings, per the reviewer contract.' \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 32
[ ! -f "$ROOT/case-32/$SHA/code-reviewer.json" ] \
  && ok "KNOWN-WRONG (residual 6): a clean wrapper quoting the tags on line 2 is denied" \
  || bad "KNOWN-WRONG (residual 6): a clean wrapper quoting the tags on line 2 is denied"
# CONTROL for case 32: the SAME transcript behind a plain one-line wrapper stamps, so the
# denial above is caused by the quoted second line and not by an unusable fixture.
async_payload "code-reviewer" "$QUOTE_TP" | run_hook 33
[ -f "$ROOT/case-33/$SHA/code-reviewer.json" ] \
  && ok "the same transcript stamps behind a one-line wrapper (residual 6 control)" \
  || bad "the same transcript stamps behind a one-line wrapper (residual 6 control)"

# --- a prior OBJECTION hand-back must survive a contract-bearing final text ----------------
# todos/archive/P1-2026-09-22-stamp-writer-takes-contract-bearing-text-over-its-own-objection.md
# Guards (a) and (b) live INSIDE `! grep -q '^REVIEWED-SHA:' <<<"$MSG"`, so a final text that
# CARRIES the contract was parsed directly and the transcript's hand-backs were never consulted.
# The reachable shape is a resumed reviewer that objected in its hand-back and then re-issued a
# clean report as plain text: the clean parse OVERWROTE the same agent's `verdict: findings`
# record at that head. Measured 2026-09-22 (PR #1010 gate-lens review) on constructed
# transcripts; every row below is one of those rows or its control.

# Case 36. One objection hand-back, then the clean contract re-issued as the final TEXT. Run as
# the two stops a resumed reviewer actually produces, into ONE private root: stop 1 (hand-back
# behind a plain wrapper) legitimately records `findings`; stop 2 (same transcript, delivered
# text now carries the contract) must leave that record standing. Before the fix stop 2 wrote
# `verdict: clean` over it.
OBJ_THEN_TEXT_TP=$(async_transcript "$FINDINGS_MSG")
async_payload "code-reviewer" "$OBJ_THEN_TEXT_TP" | run_hook 36
f36="$ROOT/case-36/$SHA/code-reviewer.json"
[ "$(jq -r .verdict "$f36" 2>/dev/null)" = "findings" ] \
  && ok "stop 1: one objection hand-back behind a plain wrapper records findings (control)" \
  || bad "stop 1: one objection hand-back behind a plain wrapper records findings (control)"
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$OBJ_THEN_TEXT_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 36
[ "$(jq -r .verdict "$f36" 2>/dev/null)" = "findings" ] \
  && ok "stop 2: contract-bearing clean text does NOT overwrite the same agent's objection record" \
  || bad "stop 2: contract-bearing clean text does NOT overwrite the same agent's objection record"

# Case 37. The same shape with NO prior record on disk -- the objection exists only in the
# transcript. Nothing may be written: "no record" is a deny at the gate, and that is the honest
# outcome for a transcript that contradicts itself.
OBJ_TEXT_FRESH_TP=$(async_transcript "$FINDINGS_MSG")
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$OBJ_TEXT_FRESH_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 37
[ ! -f "$ROOT/case-37/$SHA/code-reviewer.json" ] \
  && ok "an objection hand-back plus contract-bearing clean text writes no record" \
  || bad "an objection hand-back plus contract-bearing clean text writes no record"

# Case 38. HYBRID: two hand-backs (objection, then clean) AND the clean contract as the final
# text. Guard (b) already refuses this transcript behind a wrapper (case 25); it must refuse it
# behind contract-bearing text too, or the second delivery route launders the first.
HYB_TP=$(mktemp "$ROOT/transcript-hyb-XXXX")
jq -nc --arg m "$FINDINGS_MSG" '{type:"assistant", message:{content:[
    {type:"tool_use", name:"SubagentHandback", input:{message:$m}}]}}' >"$HYB_TP"
jq -nc --arg m "$CLEAN_MSG" '{type:"assistant", message:{content:[
    {type:"tool_use", name:"SubagentHandback", input:{message:$m}}]}}' >>"$HYB_TP"
jq -nc --arg w "$WRAPPER_LINE" '{type:"assistant", message:{content:[
    {type:"text", text:$w}]}}' >>"$HYB_TP"
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$HYB_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 38
[ ! -f "$ROOT/case-38/$SHA/code-reviewer.json" ] \
  && ok "the hybrid shape (two hand-backs, then contract-bearing text) writes no record" \
  || bad "the hybrid shape (two hand-backs, then contract-bearing text) writes no record"

# Case 39. CONTROL, the majority population (88 of 281 roster transcripts on 2026-09-14): ZERO
# hand-backs, contract in the final text. Must stamp exactly as before this change -- asserted
# with a fixture rather than by omission, because the new check runs on this path too.
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$NOHB_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 39
[ "$(jq -r .verdict "$ROOT/case-39/$SHA/code-reviewer.json" 2>/dev/null)" = "clean" ] \
  && ok "text-only delivery (no hand-backs, contract in the text) still stamps clean" \
  || bad "text-only delivery (no hand-backs, contract in the text) still stamps clean"

# Case 40. DECIDED, not accidental: one CLEAN hand-back plus a contract-bearing clean text keeps
# stamping clean. The refusal keys on an OBJECTION in a hand-back, never on the mere presence
# of one -- a reviewer that handed back clean and also wrote the report as text contradicted
# nothing, and refusing it would cost a re-dispatch for no safety gain.
CLEAN_HB_TEXT_TP=$(async_transcript "$CLEAN_MSG")
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$CLEAN_HB_TEXT_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 40
[ "$(jq -r .verdict "$ROOT/case-40/$SHA/code-reviewer.json" 2>/dev/null)" = "clean" ] \
  && ok "one CLEAN hand-back plus contract-bearing clean text still stamps clean (decided shape)" \
  || bad "one CLEAN hand-back plus contract-bearing clean text still stamps clean (decided shape)"

# Case 41. The hand-back objection rendered the way the ROSTER mandates -- a bare severity word
# with a citation (arm 2) rather than a bracketed tag (arm 1). Both arms must be consulted on
# hand-back bodies, exactly as they are on the wrapper; a bracket-only check would repeat the
# four-of-five miss that case 27 pinned for the wrapper.
ROSTER_OBJ_TP=$(async_transcript 'client/a.ts:74 — missing check — add it. CRITICAL
Withholding the trailer deliberately.')
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$ROSTER_OBJ_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 41
[ ! -f "$ROOT/case-41/$SHA/code-reviewer.json" ] \
  && ok "a roster-rendered (unbracketed) objection in the hand-back also blocks contract-bearing text" \
  || bad "a roster-rendered (unbracketed) objection in the hand-back also blocks contract-bearing text"

# Case 42. A transcript jq cannot parse must FAIL CLOSED on the contract-bearing path too
# (security review, 2026-09-22). The first version of guard (c) emptied the bodies on a jq
# failure and fell through to the text parse -- a clean stamp over an objection the hook could
# not read. The file's header policy is that an unparseable payload exits 0 writing nothing.
MALFORMED_TP=$(async_transcript "$FINDINGS_MSG")
printf 'not json\n' >>"$MALFORMED_TP"
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$MALFORMED_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 42
[ ! -f "$ROOT/case-42/$SHA/code-reviewer.json" ] \
  && ok "an unparseable transcript behind contract-bearing text writes no record (fail closed)" \
  || bad "an unparseable transcript behind contract-bearing text writes no record (fail closed)"
# Case 43 makes case 42 mean something: with the malformed line removed, case 42 is case 37 and
# refuses because of the OBJECTION. A malformed transcript carrying NO hand-back at all behind the
# same clean text must also write nothing -- the hook could not establish that no objection
# exists, so the parse failure alone is what refuses. Case 39 is the well-formed positive control.
MALFORMED_NOHB_TP=$(mktemp "$ROOT/transcript-malnohb-XXXX")
jq -nc --arg w "$WRAPPER_LINE" '{type:"assistant", message:{content:[
    {type:"text", text:$w}]}}' >"$MALFORMED_NOHB_TP"
printf 'not json\n' >>"$MALFORMED_NOHB_TP"
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$MALFORMED_NOHB_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 43
[ ! -f "$ROOT/case-43/$SHA/code-reviewer.json" ] \
  && ok "an unparseable transcript with no hand-back at all also writes nothing (the parse failure is what refuses)" \
  || bad "an unparseable transcript with no hand-back at all also writes nothing (the parse failure is what refuses)"

# --- a prior objection delivered as contract-bearing TEXT counts too (confirmation review,
# 2026-09-22). Guard (c) first read only hand-back bodies, so a reviewer that delivered its
# objection as a contract-bearing text (the majority delivery shape), was resumed, and
# re-issued a clean contract text laundered exactly as the hand-back shape did -- with no
# hand-back anywhere in the transcript. Guard (c) now also reads prior assistant TEXT bodies that
# themselves carry the contract (a prior REPORT, never working narration), excluding the
# delivered text itself. Transcripts below carry the delivered text as their last assistant
# text, the way the harness writes them.
text_msg() {  # $1 = assistant text -> one transcript line on stdout
  jq -nc --arg t "$1" '{type:"assistant", message:{content:[{type:"text", text:$t}]}}'
}

# Case 44. Stop 1 delivers a bracketed objection as text (record `findings`); stop 2, same agent
# and transcript, delivers the clean contract as text. The objection record must stand.
TT_TP=$(mktemp "$ROOT/transcript-tt-XXXX")
text_msg "$FINDINGS_MSG" >"$TT_TP"
jq -n --arg t "code-reviewer" --arg m "$FINDINGS_MSG" --arg p "$TT_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 44
f44="$ROOT/case-44/$SHA/code-reviewer.json"
[ "$(jq -r .verdict "$f44" 2>/dev/null)" = "findings" ] \
  && ok "stop 1: a findings report delivered as text, present in its own transcript, still records findings" \
  || bad "stop 1: a findings report delivered as text, present in its own transcript, still records findings"
text_msg "$CLEAN_MSG" >>"$TT_TP"
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$TT_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 44
[ "$(jq -r .verdict "$f44" 2>/dev/null)" = "findings" ] \
  && ok "stop 2: a clean contract text does NOT overwrite the same agent's text-delivered objection" \
  || bad "stop 2: a clean contract text does NOT overwrite the same agent's text-delivered objection"

# Case 45. The roster's unbracketed rendering of the same text-delivered objection, fresh root,
# no prior record: nothing may be written.
ROSTER_TT_TP=$(mktemp "$ROOT/transcript-rtt-XXXX")
text_msg 'REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/a.ts

client/a.ts:74 — missing check — add it. CRITICAL' >"$ROSTER_TT_TP"
text_msg "$CLEAN_MSG" >>"$ROSTER_TT_TP"
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$ROSTER_TT_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 45
[ ! -f "$ROOT/case-45/$SHA/code-reviewer.json" ] \
  && ok "a roster-rendered objection delivered as prior text also blocks the clean re-issue" \
  || bad "a roster-rendered objection delivered as prior text also blocks the clean re-issue"

# Case 46. CONTROL: a prior contract-bearing text that carries NO objection (a clean report for
# another head) does not refuse -- the check keys on an objection, not on a prior report.
PRIOR_CLEAN_TP=$(mktemp "$ROOT/transcript-pct-XXXX")
text_msg "$OTHER_CLEAN_MSG" >"$PRIOR_CLEAN_TP"
text_msg "$CLEAN_MSG" >>"$PRIOR_CLEAN_TP"
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$PRIOR_CLEAN_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 46
[ "$(jq -r .verdict "$ROOT/case-46/$SHA/code-reviewer.json" 2>/dev/null)" = "clean" ] \
  && ok "a prior clean report text does not refuse the clean delivery (keys on an objection)" \
  || bad "a prior clean report text does not refuse the clean delivery (keys on an objection)"

# Case 47. CONTROL: prior assistant text WITHOUT the contract is working narration, not a report,
# even when it names the format -- it must not refuse. Pins the "carries the contract" filter.
NARRATION_TP=$(mktemp "$ROOT/transcript-narr-XXXX")
text_msg 'Scanning the diff for anything that would warrant a CRITICAL or WARNING line.' >"$NARRATION_TP"
text_msg "$CLEAN_MSG" >>"$NARRATION_TP"
jq -n --arg t "code-reviewer" --arg m "$CLEAN_MSG" --arg p "$NARRATION_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 47
[ "$(jq -r .verdict "$ROOT/case-47/$SHA/code-reviewer.json" 2>/dev/null)" = "clean" ] \
  && ok "prior narration naming the format, without the contract, does not refuse (only prior REPORTS are read)" \
  || bad "prior narration naming the format, without the contract, does not refuse (only prior REPORTS are read)"

# --- the delivered text must exclude itself even when it is not byte-identical to its transcript
# copy (confirmation round 2, 2026-09-22, both reviewers). `$MSG` is captured through `$(...)`,
# which strips every trailing newline, while the transcript's `.text` keeps them; and CR
# normalisation runs LATER in the writer than guard (c). So a findings delivery ending in a
# newline, or differing from its transcript copy by CR alone, re-entered PRIOR_REPORTS as its own
# prior report, tripped an arm, and lost its `findings` record -- fail-closed, but a regression
# against main on findings deliveries. Both sides are now normalised inside the jq comparison.
# Every fixture below is a single-stop FINDINGS delivery, because a clean delivery carries no
# objection and never tripped this.
# Case 48. Trailing newline in both fields: bash strips it from $MSG, the transcript keeps it.
NL_TP=$(mktemp "$ROOT/transcript-nl-XXXX")
text_msg "$FINDINGS_MSG"$'\n' >"$NL_TP"
jq -n --arg t "code-reviewer" --arg m "$FINDINGS_MSG"$'\n' --arg p "$NL_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 48
[ "$(jq -r .verdict "$ROOT/case-48/$SHA/code-reviewer.json" 2>/dev/null)" = "findings" ] \
  && ok "a findings delivery ending in a newline still records findings (self-exclusion survives the newline strip)" \
  || bad "a findings delivery ending in a newline still records findings (self-exclusion survives the newline strip)"
# Case 49. The same, with a same-type CLEAN record already at the head: the findings delivery
# must REPLACE it (the designed fresh-delivery path). Before the fix the guard refused and the
# seeded clean record stood -- the retraction class the P3 files, reached from a single stop.
async_payload "code-reviewer" "$(async_transcript "$CLEAN_MSG")" | run_hook 49
[ "$(jq -r .verdict "$ROOT/case-49/$SHA/code-reviewer.json" 2>/dev/null)" = "clean" ] \
  && ok "case 49 seed: a clean record exists at the head before the findings delivery" \
  || bad "case 49 seed: a clean record exists at the head before the findings delivery"
NL2_TP=$(mktemp "$ROOT/transcript-nl2-XXXX")
text_msg "$FINDINGS_MSG"$'\n' >"$NL2_TP"
jq -n --arg t "code-reviewer" --arg m "$FINDINGS_MSG"$'\n' --arg p "$NL2_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 49
[ "$(jq -r .verdict "$ROOT/case-49/$SHA/code-reviewer.json" 2>/dev/null)" = "findings" ] \
  && ok "a findings delivery ending in a newline replaces a seeded same-type clean record" \
  || bad "a findings delivery ending in a newline replaces a seeded same-type clean record"
# Case 50. CR-only mismatch: the payload carries CRLF line endings, the transcript copy LF.
FINDINGS_CRLF=${FINDINGS_MSG//$'\n'/$'\r\n'}
CR_TP=$(mktemp "$ROOT/transcript-cr-XXXX")
text_msg "$FINDINGS_MSG" >"$CR_TP"
jq -n --arg t "code-reviewer" --arg m "$FINDINGS_CRLF" --arg p "$CR_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 50
[ "$(jq -r .verdict "$ROOT/case-50/$SHA/code-reviewer.json" 2>/dev/null)" = "findings" ] \
  && ok "a CR-only payload/transcript mismatch still records findings" \
  || bad "a CR-only payload/transcript mismatch still records findings"
# Case 51. CONTROL: a trailing SPACE is not stripped by the capture, so both sides are
# byte-identical and the delivery excluded itself before the fix too. Green on both sides, which
# is what shows cases 48-50 are about the strip and not about trailing bytes in general.
SP_TP=$(mktemp "$ROOT/transcript-sp-XXXX")
text_msg "$FINDINGS_MSG " >"$SP_TP"
jq -n --arg t "code-reviewer" --arg m "$FINDINGS_MSG " --arg p "$SP_TP" \
  '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t,
    last_assistant_message:$m, agent_transcript_path:$p}' | run_hook 51
[ "$(jq -r .verdict "$ROOT/case-51/$SHA/code-reviewer.json" 2>/dev/null)" = "findings" ] \
  && ok "CONTROL: a trailing space survives the capture, so the delivery excluded itself either way" \
  || bad "CONTROL: a trailing space survives the capture, so the delivery excluded itself either way"

# Pin the assertion TOTAL, mirroring test-cmd-detect.sh's own EXPECTED_TOTAL pin. Without it a row that is
# skipped -- a `command not found` on a tool a fixture needs, an early `exit` in a helper,
# a truncated file -- subtracts silently and the suite still prints a clean pass/0 fail.
# Same caveat as the sibling pin: this catches a MISSING assertion, not an assertion that
# never ran because the process died before reaching it.
# 66 -> 73 (2026-09-22): +7, the prior-objection rows above (cases 36-41; case 36 asserts both stops).
# 73 -> 75 (2026-09-22, security review round 1): +2, the unparseable-transcript rows (cases 42-43).
# 75 -> 80 (2026-09-22, confirmation round): +5, the text-delivered prior objection (cases 44-47;
# case 44 asserts both stops).
# 80 -> 85 (2026-09-22, confirmation round 2): +5, the self-exclusion normalisation rows (cases
# 48-51; case 49 asserts its seed).
EXPECTED_TOTAL=85
if [ $((PASS + FAIL)) -ne "$EXPECTED_TOTAL" ]; then
  echo "FAIL: assertion total is $((PASS + FAIL)), expected $EXPECTED_TOTAL — an assertion was skipped, or the total changed without updating this pin"
  FAIL=$((FAIL + 1))
fi

echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
