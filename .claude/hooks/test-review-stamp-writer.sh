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

# 2. Parallel roster dispatch: a second reviewer coexists, never clobbers.
payload "server-reviewer" "$CLEAN_MSG" | run_hook
[ -f "$ROOT/$SHA/server-reviewer.json" ] && [ -f "$f" ] \
  && ok "two reviewers coexist under one SHA" || bad "two reviewers coexist under one SHA"

# 3. CRITICAL findings are recorded as unresolved; SUGGESTION is not.
payload "mobile-reviewer" "$FINDINGS_MSG" | run_hook
g="$ROOT/$SHA/mobile-reviewer.json"
[ "$(jq -r .verdict "$g" 2>/dev/null)" = "findings" ] && ok "verdict findings" || bad "verdict findings"
[ "$(jq -r '.unresolved | length' "$g" 2>/dev/null)" = "1" ] \
  && ok "only CRITICAL counts as unresolved" || bad "only CRITICAL counts as unresolved"

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

echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
