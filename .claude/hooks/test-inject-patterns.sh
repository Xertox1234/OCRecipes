#!/usr/bin/env bash
# Tests for inject-patterns.sh — run from project root
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/inject-patterns.sh"
SPILL_FILE="/tmp/ocrecipes-injection-context.md"
PASS=0; FAIL=0

# run_hook: clear stale spill, invoke hook, echo stdout+spill combined so callers can grep both.
# Multi-domain matches routinely exceed the 9 KB inline cap and the hook copies overflow to
# $SPILL_FILE — searching both keeps tests assertion-correct without depending on which side
# of the threshold a given input lands on.
run_hook() {
  local input="$1"
  rm -f "$SPILL_FILE"
  local output
  output=$(echo "$input" | bash "$HOOK" 2>/dev/null || true)
  local spill=""
  [ -f "$SPILL_FILE" ] && spill=$(cat "$SPILL_FILE")
  printf '%s\n%s' "$output" "$spill"
}

check() {
  local name="$1" input="$2" pattern="$3"
  local combined
  combined=$(run_hook "$input")
  if echo "$combined" | grep -q "$pattern"; then
    echo "PASS: $name"; PASS=$((PASS + 1))
  else
    echo "FAIL: $name"; echo "  expected to find (in stdout or spill): $pattern"; FAIL=$((FAIL + 1))
  fi
}

check_no_match() {
  local name="$1" input="$2" pattern="$3"
  local combined
  combined=$(run_hook "$input")
  if echo "$combined" | grep -q "$pattern"; then
    echo "FAIL: $name (expected NOT to find: $pattern)"; FAIL=$((FAIL + 1))
  else
    echo "PASS: $name"; PASS=$((PASS + 1))
  fi
}

# check_empty: hook short-circuited entirely (no JSON, no preamble). Used for tools the hook
# rejects (non-Edit/Write) or malformed input. Edit/Write with a valid file_path always emits
# at least the discipline preamble — use check + check_no_match for that case instead.
check_empty() {
  local name="$1" input="$2"
  local output
  rm -f "$SPILL_FILE"
  output=$(echo "$input" | bash "$HOOK" 2>/dev/null || true)
  if [ -z "$output" ]; then
    echo "PASS: $name"; PASS=$((PASS + 1))
  else
    echo "FAIL: $name (expected empty)"; echo "  got: $(echo "$output" | head -3)"; FAIL=$((FAIL + 1))
  fi
}

# server/routes → api + security + architecture + typescript
check "server/routes → api rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — api"

check "server/routes → security rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — security"

check "server/routes → solution references" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "SOLUTIONS — api"

# typescript domain is suppressed when any more-specific domain matched (option (a)
# from todos/archive/2026-05-12-pattern-injection-spill-on-multi-domain-edits.md).
# Keeps the 4-domain stack under the 9000-byte spill threshold.
check_not() {
  local name="$1" input="$2" pattern="$3"
  local output
  output=$(echo "$input" | bash "$HOOK" 2>/dev/null || true)
  if echo "$output" | grep -q "$pattern"; then
    echo "FAIL: $name (pattern '$pattern' should be absent)"; FAIL=$((FAIL + 1))
  else
    echo "PASS: $name"; PASS=$((PASS + 1))
  fi
}

check_not "server/routes → typescript rules suppressed (more-specific domain matched)" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "RULES — typescript"

# typescript remains the fallback for .ts/.tsx files that match no other domain
check "shared/types.ts → typescript rules (fallback when no other domain matched)" \
  '{"tool_name":"Edit","tool_input":{"file_path":"shared/types.ts"}}' \
  "RULES — typescript"

# client/screens → react-native + accessibility + design-system
check "client/screens → accessibility rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/screens/HomeScreen.tsx"}}' \
  "RULES — accessibility"

check "client/screens → react-native rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/screens/HomeScreen.tsx"}}' \
  "RULES — react-native"

# server/storage → database
check "server/storage → database rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/storage/recipes.ts"}}' \
  "RULES — database"

# client/hooks → hooks + client-state
check "client/hooks → hooks rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"client/hooks/useRecipes.ts"}}' \
  "RULES — hooks"

# Output is valid JSON
check "output is valid JSON with hookSpecificOutput" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}' \
  "hookSpecificOutput"

# Read tool → no output (not Edit or Write)
check_empty "Read tool → no output" \
  '{"tool_name":"Read","tool_input":{"file_path":"server/routes/recipes.ts"}}'

# Missing file_path → no output (graceful degradation)
check_empty "missing file_path → no output" \
  '{"tool_name":"Edit","tool_input":{}}'

# File with no domain match → discipline preamble only (no RULES/PATTERNS blocks).
# The hook emits the preamble unconditionally for Edit/Write on a valid file_path so the
# agent always sees the workflow reminders, even when no domain mapping triggers.
check "package.json → discipline preamble emitted" \
  '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}' \
  "DISCIPLINE"

check_no_match "package.json → no domain RULES blocks" \
  '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}' \
  "RULES — "

check_no_match "package.json → no PATTERNS blocks" \
  '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}' \
  "PATTERNS — "

# AI service file must get architecture domain (case exclusivity regression)
check "AI service → architecture rules (additive match)" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/services/photo-analysis.ts"}}' \
  "RULES — architecture"

check "AI service → ai-prompting rules still present" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/services/photo-analysis.ts"}}' \
  "RULES — ai-prompting"

# Test file inside a route directory must get testing domain (case exclusivity regression)
check "route __tests__ file → testing rules (additive match)" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/__tests__/recipes.test.ts"}}' \
  "RULES — testing"

check "route __tests__ file → api rules still present" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/routes/__tests__/recipes.test.ts"}}' \
  "RULES — api"

# client/components/** must include performance per copilot-instructions table
check "client/components → performance rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/components/RecipeCard.tsx"}}' \
  "RULES — performance"

check "client/components → react-native rules" \
  '{"tool_name":"Write","tool_input":{"file_path":"client/components/RecipeCard.tsx"}}' \
  "RULES — react-native"

# evals/** must map to ai-prompting + testing (no security)
check "evals/** → ai-prompting rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"evals/runner.ts"}}' \
  "RULES — ai-prompting"

check "evals/** → testing rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"evals/runner.ts"}}' \
  "RULES — testing"

check_no_match "evals/** → no security rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"evals/runner.ts"}}' \
  "RULES — security"

# .github/workflows/** → architecture + testing
check ".github/workflows → architecture rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":".github/workflows/ci.yml"}}' \
  "RULES — architecture"

check ".github/workflows → testing rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":".github/workflows/ci.yml"}}' \
  "RULES — testing"

# Root tool configs → testing + typescript (eslint.config.js is not .ts/.tsx,
# so typescript must come from the explicit config rule)
check "eslint.config.js → testing rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"eslint.config.js"}}' \
  "RULES — testing"

check "eslint.config.js → typescript rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"eslint.config.js"}}' \
  "RULES — typescript"

check "vitest.config.ts → testing rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"vitest.config.ts"}}' \
  "RULES — testing"

# AI service must NOT have security as a directly-injected domain — the
# copilot-instructions table maps LLM-touching services to {architecture, ai-prompting} only.
check_no_match "AI service → no security rules" \
  '{"tool_name":"Edit","tool_input":{"file_path":"server/services/photo-analysis.ts"}}' \
  "RULES — security"

# --- Priority-ordering / inline-budget regression ---
# A 3-domain storage edit (database+security+architecture) overflows the inline cap.
# When it does, the highest-stakes domain (security) must take the inline budget rather
# than being truncated to a sliver by accident of match order. These assertions look at
# the INLINE additionalContext only (NOT the combined stdout+spill the other checks use),
# because the whole point is what survives truncation vs what gets pushed to /tmp.

# inline_ctx: decode ONLY the inline additionalContext the agent receives (excludes spill).
inline_ctx() {
  local input="$1"
  rm -f "$SPILL_FILE"
  echo "$input" | bash "$HOOK" 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || true
}

# sec_inline_bytes: bytes of the security RULES section that survived INLINE for an input.
sec_inline_bytes() {
  inline_ctx "$1" \
    | awk '/^\[RULES — security\]/{f=1;next} /^\[(RULES|SOLUTIONS|TRUNCATED|NOTE)/{f=0} f' \
    | wc -c | tr -d ' '
}

STORAGE_INPUT='{"tool_name":"Edit","tool_input":{"file_path":"server/storage/recipes.ts"}}'

# On a 3-domain storage edit, security (highest priority) is emitted first and must survive
# inline essentially in full — never truncated to a sliver by match order. The threshold
# scales with the file so trimming security.md doesn't break this assertion.
SEC_FULL=$(wc -c < "$(cd "$(dirname "$0")/../.." && pwd)/docs/rules/security.md" | tr -d ' ')
SEC_MIN=$((SEC_FULL * 90 / 100))
SEC_BYTES=$(sec_inline_bytes "$STORAGE_INPUT")
if [ "${SEC_BYTES:-0}" -ge "$SEC_MIN" ]; then
  echo "PASS: storage edit → security rules near-fully inline (${SEC_BYTES}/${SEC_FULL} B)"; PASS=$((PASS + 1))
else
  echo "FAIL: storage edit → security rules near-fully inline (got ${SEC_BYTES} B, want >=${SEC_MIN})"; FAIL=$((FAIL + 1))
fi

# security header must survive inline...
if inline_ctx "$STORAGE_INPUT" | grep -q '\[RULES — security\]'; then
  echo "PASS: storage edit → security present inline"; PASS=$((PASS + 1))
else
  echo "FAIL: storage edit → security present inline"; FAIL=$((FAIL + 1))
fi

# ...while architecture (lowest priority) may spill, but must remain available in the spill.
check "storage edit → architecture still delivered (inline or spill)" \
  "$STORAGE_INPUT" "RULES — architecture"

# --- Session-scoped dedup ---
# Each domain's full rules are injected only the first time it appears in a session; later
# edits get a one-line pointer. Requires a real session_id; absent it (or with the escape
# hatch) dedup is OFF. "getEffectiveTierForUser" is a security-body sentinel present only when
# full rules are injected.
DEDUP_SESS_A='{"session_id":"itest-dedup-A","tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}'
DEDUP_SESS_B='{"session_id":"itest-dedup-B","tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}'
rm -f /tmp/ocrecipes-pattern-inject-itest-dedup-A /tmp/ocrecipes-pattern-inject-itest-dedup-B

first=$(inline_ctx "$DEDUP_SESS_A")
if echo "$first" | grep -qF "getEffectiveTierForUser" && ! echo "$first" | grep -qF "already injected"; then
  echo "PASS: dedup → first edit in a session injects full rules"; PASS=$((PASS + 1))
else
  echo "FAIL: dedup → first edit in a session injects full rules"; FAIL=$((FAIL + 1))
fi

second=$(inline_ctx "$DEDUP_SESS_A")
if echo "$second" | grep -qF "already injected" && ! echo "$second" | grep -qF "getEffectiveTierForUser"; then
  echo "PASS: dedup → repeat edit emits pointer, not full rules"; PASS=$((PASS + 1))
else
  echo "FAIL: dedup → repeat edit emits pointer, not full rules"; FAIL=$((FAIL + 1))
fi

other=$(inline_ctx "$DEDUP_SESS_B")
if echo "$other" | grep -qF "getEffectiveTierForUser"; then
  echo "PASS: dedup → a different session re-injects full rules"; PASS=$((PASS + 1))
else
  echo "FAIL: dedup → a different session re-injects full rules"; FAIL=$((FAIL + 1))
fi

forced=$(echo "$DEDUP_SESS_A" | PATTERN_INJECT_NO_DEDUP=1 bash "$HOOK" 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext')
if echo "$forced" | grep -qF "getEffectiveTierForUser"; then
  echo "PASS: dedup → PATTERN_INJECT_NO_DEDUP=1 forces full rules on a used session"; PASS=$((PASS + 1))
else
  echo "FAIL: dedup → PATTERN_INJECT_NO_DEDUP=1 forces full rules on a used session"; FAIL=$((FAIL + 1))
fi

NOSESS='{"tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}'
ns1=$(inline_ctx "$NOSESS"); ns2=$(inline_ctx "$NOSESS")
if echo "$ns1" | grep -qF "getEffectiveTierForUser" && echo "$ns2" | grep -qF "getEffectiveTierForUser" && ! echo "$ns2" | grep -qF "already injected"; then
  echo "PASS: dedup → session-less edits always get full rules (back-compat)"; PASS=$((PASS + 1))
else
  echo "FAIL: dedup → session-less edits always get full rules (back-compat)"; FAIL=$((FAIL + 1))
fi

rm -f /tmp/ocrecipes-pattern-inject-itest-dedup-A /tmp/ocrecipes-pattern-inject-itest-dedup-B

# --- Preamble session dedup ---
# The ~1.1KB DISCIPLINE preamble is injected in full at most once per session (marker
# `__preamble__` in the dedup state file); later edits get a one-line pointer. A wiped
# state file fails OPEN to the full preamble. package.json maps to no domain, isolating
# the preamble from domain payloads. "Surgical changes" is a preamble-body sentinel.
PRE_SESS='{"session_id":"itest-preamble","tool_name":"Edit","tool_input":{"file_path":"package.json"}}'
PRE_STATE=/tmp/ocrecipes-pattern-inject-itest-preamble
rm -f "$PRE_STATE"

p1=$(inline_ctx "$PRE_SESS")
if echo "$p1" | grep -qF "Surgical changes" && ! echo "$p1" | grep -qF "[DISCIPLINE] injected earlier"; then
  echo "PASS: preamble dedup → first edit in a session gets the full preamble"; PASS=$((PASS + 1))
else
  echo "FAIL: preamble dedup → first edit in a session gets the full preamble"; FAIL=$((FAIL + 1))
fi

p2=$(inline_ctx "$PRE_SESS")
if echo "$p2" | grep -qF "[DISCIPLINE] injected earlier" && ! echo "$p2" | grep -qF "Surgical changes"; then
  echo "PASS: preamble dedup → repeat edit emits a one-line pointer, not the full preamble"; PASS=$((PASS + 1))
else
  echo "FAIL: preamble dedup → repeat edit emits a one-line pointer, not the full preamble"; FAIL=$((FAIL + 1))
fi

rm -f "$PRE_STATE"
p3=$(inline_ctx "$PRE_SESS")
if echo "$p3" | grep -qF "Surgical changes"; then
  echo "PASS: preamble dedup → wiped state file fails open to the full preamble"; PASS=$((PASS + 1))
else
  echo "FAIL: preamble dedup → wiped state file fails open to the full preamble"; FAIL=$((FAIL + 1))
fi
rm -f "$PRE_STATE"

pns1=$(inline_ctx '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}')
pns2=$(inline_ctx '{"tool_name":"Edit","tool_input":{"file_path":"package.json"}}')
if echo "$pns1" | grep -qF "Surgical changes" && echo "$pns2" | grep -qF "Surgical changes"; then
  echo "PASS: preamble dedup → session-less edits always get the full preamble"; PASS=$((PASS + 1))
else
  echo "FAIL: preamble dedup → session-less edits always get the full preamble"; FAIL=$((FAIL + 1))
fi

# --- First-touch payloads fit inline (deferral instead of truncation) ---
# With session dedup ON, a first-touch multi-domain edit must land under the spill
# threshold: over-budget domains are deferred with a one-line pointer (and NOT recorded in
# the dedup state) instead of byte-truncating the payload. Their full payloads land in the
# spill file (recoverable now), so the spill file EXISTING is expected — the failure mode
# being pinned is the inline TRUNCATED marker. The two hottest edit paths
# (client/components: 4 domains; server/routes: 3 domains) both truncated before deferral
# existed. The byte bound is derived from the hook's THRESHOLD, not hardcoded.
THRESH=$(grep -m1 '^THRESHOLD=' "$HOOK" | cut -d= -f2)
for tf in client/components/RecipeCard.tsx server/routes/recipes.ts; do
  sid="itest-firsttouch-$(basename "$tf" | tr '.' '-')"
  rm -f "/tmp/ocrecipes-pattern-inject-${sid}"
  ft=$(inline_ctx "{\"session_id\":\"${sid}\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"${tf}\"}}")
  ft_bytes=$(printf '%s' "$ft" | wc -c | tr -d ' ')
  if [ "${ft_bytes:-99999}" -le "${THRESH:-9000}" ] && ! echo "$ft" | grep -q "TRUNCATED"; then
    echo "PASS: first touch $tf fits inline (${ft_bytes} B, no truncation)"; PASS=$((PASS + 1))
  else
    echo "FAIL: first touch $tf fits inline (got ${ft_bytes} B vs cap ${THRESH:-9000}, or TRUNCATED marker present)"; FAIL=$((FAIL + 1))
  fi
  rm -f "/tmp/ocrecipes-pattern-inject-${sid}"
done

# A client/context/** edit maps to a SINGLE domain (client-state): deferral cannot help a
# lone over-budget domain (the first domain always emits in full), so this fits inline only
# once docs/rules/client-state.md is under the size cap. Regression guard for the trim in
# todos/archive/P3-2026-07-03-client-state-rules-trim.md.
CS_SID="itest-firsttouch-client-context"
rm -f "/tmp/ocrecipes-pattern-inject-${CS_SID}"
cs=$(inline_ctx "{\"session_id\":\"${CS_SID}\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"client/context/AuthContext.tsx\"}}")
cs_bytes=$(printf '%s' "$cs" | wc -c | tr -d ' ')
# Positive assertion: the rules-file H1 is cat'd verbatim ONLY on the full-inline emit path.
# Without it, an empty or preamble-only injection (broken hook / path→domain mapping) would
# satisfy "byte-count under cap AND no TRUNCATED marker" and fail open — a green test that
# never proved client-state was injected at all.
cs_has_rules=$(printf '%s\n' "$cs" | grep -c "^# Client State Rules")
if [ "${cs_bytes:-99999}" -le "${THRESH:-9000}" ] && [ "${cs_has_rules:-0}" -ge 1 ] && ! echo "$cs" | grep -q "TRUNCATED"; then
  echo "PASS: first touch client/context (single-domain client-state) injected inline (${cs_bytes} B, rules present, no truncation)"; PASS=$((PASS + 1))
else
  echo "FAIL: first touch client/context inline (got ${cs_bytes} B vs cap ${THRESH:-9000}; client-state rules present=${cs_has_rules:-0}; or TRUNCATED marker present)"; FAIL=$((FAIL + 1))
fi
rm -f "/tmp/ocrecipes-pattern-inject-${CS_SID}"

# --- Deferred domains catch up on the next edit ---
# server/routes first touch defers api (rank 40) behind security (rank 10); the second
# edit must inject the deferred domain IN FULL — proving a deferred domain is not recorded
# in the dedup state. "handleRouteError" is an api-body sentinel.
DEFER_SESS='{"session_id":"itest-defer","tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}'
rm -f /tmp/ocrecipes-pattern-inject-itest-defer
d1=$(inline_ctx "$DEFER_SESS")
if echo "$d1" | grep -qF "[RULES — api] deferred" && ! echo "$d1" | grep -qF "handleRouteError"; then
  echo "PASS: deferral → first touch defers api with a pointer, not a truncated body"; PASS=$((PASS + 1))
else
  echo "FAIL: deferral → first touch defers api with a pointer, not a truncated body"; FAIL=$((FAIL + 1))
fi
# api is pre-estimate-deferred here (its rules alone overflow the budget), so the perf skip
# means only its RULES body reaches the spill now — the solution refs are not built (asserted
# absent in the server/storage test below, where the margin is trim-robust). The full payload
# incl. solution refs auto-injects on the NEXT edit (asserted just below). This is the
# documented "rules now, solution refs next edit" recoverability trade.
if [ -f "$SPILL_FILE" ] && grep -qF "handleRouteError" "$SPILL_FILE"; then
  echo "PASS: deferral → pre-estimated api ships its RULES body to the spill file now"; PASS=$((PASS + 1))
else
  echo "FAIL: deferral → pre-estimated api ships its RULES body to the spill file now"; FAIL=$((FAIL + 1))
fi
d2=$(inline_ctx "$DEFER_SESS")
# The FULL payload catches up on edit 2: both the rules body AND the solution refs that the
# pre-estimate skipped on edit 1 must now inject in full.
if echo "$d2" | grep -qF "handleRouteError" && echo "$d2" | grep -qF "SOLUTIONS — api" && echo "$d2" | grep -qF "[RULES — security] already injected"; then
  echo "PASS: deferral → deferred domain injects in full (rules + solution refs) on the next edit"; PASS=$((PASS + 1))
else
  echo "FAIL: deferral → deferred domain injects in full (rules + solution refs) on the next edit"; FAIL=$((FAIL + 1))
fi
rm -f /tmp/ocrecipes-pattern-inject-itest-defer

# --- Pre-estimate deferral skips the solutions_from_markdown corpus sweep ---
# A domain whose RULES alone overflow the budget is certain to defer regardless of solution
# refs, so the hook defers it WITHOUT running solutions_from_markdown (~50-70ms saved/domain).
# server/storage defers `database` behind `security`: docs/rules/database.md (~6.3KB) overflows
# rules-only by a wide, trim-robust margin (unlike the tight api case above), so this reliably
# exercises the pre-estimate path. The pre-estimated pointer names it; its RULES reach the
# spill but its SOLUTIONS block is never built — the documented "rules now, solution refs next
# edit" recoverability trade. The full payload still catches up on the session's next edit.
PREEST_SESS='{"session_id":"itest-preest","tool_name":"Edit","tool_input":{"file_path":"server/storage/recipes.ts"}}'
rm -f /tmp/ocrecipes-pattern-inject-itest-preest
pe1=$(inline_ctx "$PREEST_SESS")
pe_spill=""; [ -f "$SPILL_FILE" ] && pe_spill=$(cat "$SPILL_FILE")
if echo "$pe1" | grep -qF "[RULES — database] deferred (inline size cap, pre-estimated)"; then
  echo "PASS: pre-estimate → database deferred via the cheap pre-estimate (pointer present)"; PASS=$((PASS + 1))
else
  echo "FAIL: pre-estimate → database deferred via the cheap pre-estimate (pointer present)"; FAIL=$((FAIL + 1))
fi
# RULES recoverable in the spill now; SOLUTIONS — database never built (the perf saving).
if echo "$pe_spill" | grep -qF "[RULES — database]" && ! echo "$pe_spill" | grep -qF "SOLUTIONS — database"; then
  echo "PASS: pre-estimate → database RULES in spill now, SOLUTIONS sweep skipped"; PASS=$((PASS + 1))
else
  echo "FAIL: pre-estimate → database RULES in spill now, SOLUTIONS sweep skipped"; FAIL=$((FAIL + 1))
fi
# Catch-up: the skipped SOLUTIONS — database must inject in full on the session's next edit.
pe2=$(inline_ctx "$PREEST_SESS")
if echo "$pe2" | grep -qF "SOLUTIONS — database"; then
  echo "PASS: pre-estimate → skipped SOLUTIONS — database catch up on the next edit"; PASS=$((PASS + 1))
else
  echo "FAIL: pre-estimate → skipped SOLUTIONS — database catch up on the next edit"; FAIL=$((FAIL + 1))
fi
rm -f /tmp/ocrecipes-pattern-inject-itest-preest

# Static guard: the hook is markdown-only — a psql/DB path must not creep back in
# (the solutions DB was retired 2026-07; docs/solutions/ is the canonical store).
if grep -qE 'psql|solutions_from_db|SOLUTIONS_DB_READONLY_URL|PATTERN_INJECT_SOURCE' "$HOOK"; then
  echo "FAIL: hook is markdown-only (found a retired DB-path reference)"; FAIL=$((FAIL + 1))
else
  echo "PASS: hook is markdown-only (no DB-path references)"; PASS=$((PASS + 1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
