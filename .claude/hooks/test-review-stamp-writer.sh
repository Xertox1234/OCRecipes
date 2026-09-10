#!/usr/bin/env bash
# Tests for review-stamp-writer.sh — run from project root. Hermetic: stdin JSON only,
# stamps land in a throwaway REVIEW_STAMP_ROOT. The hook must never invoke git.
set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HOOKS_DIR/review-stamp-writer.sh"
PASS=0; FAIL=0
ROOT=$(mktemp -d "/tmp/review-stamp-writer-test-$$-XXXX")
trap 'rm -rf "$ROOT"' EXIT

run_hook() { REVIEW_STAMP_ROOT="$ROOT" bash "$HOOK" >/dev/null 2>&1; }

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

# 5. The hook must not shell out to git (it has no trustworthy cwd — AI_WORKFLOW.md:40).
#    Strip comment lines FIRST: the hook's own header explains why `git rev-parse HEAD`
#    would be wrong here, and a naive grep matches that prose and fails on the explanation.
if grep -vE '^[[:space:]]*#' "$HOOK" | grep -qE '(^|[^a-z_])git '; then
  bad "hook must not invoke git"
else
  ok "hook does not invoke git"
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

payload "nosignal-a" "$NO_SIGNAL_TRUNCATED" | run_hook
payload "nosignal-b" "$NO_SIGNAL_HEADING" | run_hook
payload "nosignal-c" "$NO_SIGNAL_BOLD" | run_hook
payload "nosignal-d" "$NO_SIGNAL_WARNING_THEN_MISCASED" | run_hook
[ ! -f "$ROOT/$SHA/nosignal-a.json" ] && ok "truncated-at-header writes no stamp" || bad "truncated-at-header writes no stamp"
[ ! -f "$ROOT/$SHA/nosignal-b.json" ] && ok "markdown-heading (untagged) writes no stamp" || bad "markdown-heading (untagged) writes no stamp"
[ ! -f "$ROOT/$SHA/nosignal-c.json" ] && ok "bold-markdown (untagged) writes no stamp" || bad "bold-markdown (untagged) writes no stamp"
[ ! -f "$ROOT/$SHA/nosignal-d.json" ] && ok "[WARNING]-then-miscased-CRITICAL writes no stamp (digest was correct; verdict was not)" || bad "[WARNING]-then-miscased-CRITICAL writes no stamp (digest was correct; verdict was not)"

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
payload "nosignal-control-critical" "$CONTROL_CRITICAL_MSG" | run_hook
payload "nosignal-control-clean" "$CONTROL_CLEAN_MSG" | run_hook
k="$ROOT/$SHA/nosignal-control-critical.json"
l="$ROOT/$SHA/nosignal-control-clean.json"
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
payload "round2-miscased-stray" "$ROUND2_MISCASED_STRAY_MSG" | run_hook
[ ! -f "$ROOT/$SHA/round2-miscased-stray.json" ] \
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
payload "round2-bare-bracket" "$ROUND2_BARE_BRACKET_MSG" | run_hook
m="$ROOT/$SHA/round2-bare-bracket.json"
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

# 12. Trailing spaces on the SAME line as the literal (an editor/renderer artifact) must
#     not defeat the exact-match comparison.
TRAILING_WS_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

No findings.   '
payload "round3-trailing-ws" "$TRAILING_WS_MSG" | run_hook
[ "$(jq -r .verdict "$ROOT/$SHA/round3-trailing-ws.json" 2>/dev/null)" = "clean" ] \
  && ok "trailing whitespace after the literal does not defeat verdict:clean (fix a2)" \
  || bad "trailing whitespace after the literal does not defeat verdict:clean (fix a2)"

# 13. A trailing CR (CRLF line ending) on the literal's own line must not defeat it either.
CRLF_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

No findings.'$'\r'
payload "round3-crlf" "$CRLF_MSG" | run_hook
[ "$(jq -r .verdict "$ROOT/$SHA/round3-crlf.json" 2>/dev/null)" = "clean" ] \
  && ok "a trailing CR on the literal's line does not defeat verdict:clean (fix a2)" \
  || bad "a trailing CR on the literal's line does not defeat verdict:clean (fix a2)"

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
payload "round3-roster-clean" "$ROSTER_CLEAN_MSG" | run_hook
[ "$(jq -r .verdict "$ROOT/$SHA/round3-roster-clean.json" 2>/dev/null)" = "clean" ] \
  && ok "roster-shaped clean review (patterns list ABOVE the final literal) produces verdict:clean" \
  || bad "roster-shaped clean review (patterns list ABOVE the final literal) produces verdict:clean"

echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
