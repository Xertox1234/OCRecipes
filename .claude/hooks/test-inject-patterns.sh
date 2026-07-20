#!/usr/bin/env bash
# Tests for inject-patterns.sh — run from project root
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HOOK_DIR/inject-patterns.sh"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SPILL_FILE="/tmp/ocrecipes-injection-context.md"
# This suite's every invocation of $HOOK would otherwise also fire the PG Lab usage-telemetry
# tail block (scripts/pg-lab/log-injection.sh), permanently polluting a developer's real
# local ocrecipes_lab.harness.injection_log with dozens of test-run rows indistinguishable
# from genuine usage (that table is append-only and never pruned programmatically). The
# dedicated byte-identical logging on/off/DB-down assertions near the end of this file
# unset this locally (against a throwaway DB, never the real one) to actually exercise the
# telemetry path; every other invocation in this suite must stay opted out.
export PATTERN_INJECT_NO_LOG=1
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

# --- Per-context-window dedup (agent_id-qualified key) ---
# A dispatched subagent shares its parent's session_id (hook JSON AND the Bash
# CLAUDE_CODE_SESSION_ID env var — verified 2026-07-17), but the hook JSON also carries a
# per-dispatch `agent_id` field, absent at the top level and distinct per Agent-tool
# invocation (verified 2026-07-19). Regression guard for 2026-07-18 harness audit finding M1:
# a freshly spawned subagent's first Edit/Write must get the FULL payload even though it
# shares session_id with a context that already exhausted that session's dedup state — same
# session_id, different agent_id must be a fresh key. "getEffectiveTierForUser" is the same
# security-body sentinel used by the session-scoped dedup checks above.
AGENTID_TOPLEVEL='{"session_id":"itest-agentid-A","tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}'
AGENTID_SUBAGENT='{"session_id":"itest-agentid-A","agent_id":"itest-sub-1","tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}'
rm -f /tmp/ocrecipes-pattern-inject-itest-agentid-A /tmp/ocrecipes-pattern-inject-itest-agentid-A-agent-itest-sub-1

top1=$(inline_ctx "$AGENTID_TOPLEVEL")
if echo "$top1" | grep -qF "getEffectiveTierForUser" && ! echo "$top1" | grep -qF "already injected"; then
  echo "PASS: agent-id dedup → top-level (no agent_id) first edit injects full rules"; PASS=$((PASS + 1))
else
  echo "FAIL: agent-id dedup → top-level (no agent_id) first edit injects full rules"; FAIL=$((FAIL + 1))
fi

sub1=$(inline_ctx "$AGENTID_SUBAGENT")
if echo "$sub1" | grep -qF "getEffectiveTierForUser" && ! echo "$sub1" | grep -qF "already injected"; then
  echo "PASS: agent-id dedup → subagent's first touch (shared session_id, distinct agent_id) still gets full rules"; PASS=$((PASS + 1))
else
  echo "FAIL: agent-id dedup → subagent's first touch (shared session_id, distinct agent_id) still gets full rules"; FAIL=$((FAIL + 1))
fi

sub2=$(inline_ctx "$AGENTID_SUBAGENT")
if echo "$sub2" | grep -qF "already injected" && ! echo "$sub2" | grep -qF "getEffectiveTierForUser"; then
  echo "PASS: agent-id dedup → subagent's repeat edit (same agent_id) emits pointer, cost bound preserved"; PASS=$((PASS + 1))
else
  echo "FAIL: agent-id dedup → subagent's repeat edit (same agent_id) emits pointer, cost bound preserved"; FAIL=$((FAIL + 1))
fi

rm -f /tmp/ocrecipes-pattern-inject-itest-agentid-A /tmp/ocrecipes-pattern-inject-itest-agentid-A-agent-itest-sub-1

# Same coverage for the DISCIPLINE preamble — M1 named the preamble alongside domain rules,
# and it dedups via the same `__preamble__` marker in DEDUP_STATE. package.json maps to no
# domain, isolating the preamble from domain payloads. "Surgical changes" is the preamble
# sentinel used by the preamble dedup tests below.
AGENTID_PRE_TOP='{"session_id":"itest-agentid-pre","tool_name":"Edit","tool_input":{"file_path":"package.json"}}'
AGENTID_PRE_SUB='{"session_id":"itest-agentid-pre","agent_id":"itest-sub-pre","tool_name":"Edit","tool_input":{"file_path":"package.json"}}'
rm -f /tmp/ocrecipes-pattern-inject-itest-agentid-pre /tmp/ocrecipes-pattern-inject-itest-agentid-pre-agent-itest-sub-pre

pretop=$(inline_ctx "$AGENTID_PRE_TOP")
presub=$(inline_ctx "$AGENTID_PRE_SUB")
if echo "$pretop" | grep -qF "Surgical changes" && echo "$presub" | grep -qF "Surgical changes" && ! echo "$presub" | grep -qF "injected earlier"; then
  echo "PASS: agent-id dedup → subagent's first touch still gets the full preamble after top-level already consumed it"; PASS=$((PASS + 1))
else
  echo "FAIL: agent-id dedup → subagent's first touch still gets the full preamble after top-level already consumed it"; FAIL=$((FAIL + 1))
fi

rm -f /tmp/ocrecipes-pattern-inject-itest-agentid-pre /tmp/ocrecipes-pattern-inject-itest-agentid-pre-agent-itest-sub-pre

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
# shared/schema.ts first touch defers `database` (rank 20) behind `security` (rank 10); the
# second edit must inject the deferred domain IN FULL — proving a deferred domain is not
# recorded in the dedup state. This fixture (like the `itest-preest` case below) is chosen for
# COMFORTABLE headroom: docs/rules/database.md alone (~6.3KB) overflows the remaining budget by
# a wide, trim-robust margin (~5.5KB) — this test previously used server/routes.ts (`api`
# domain), whose rules file (~1KB) only cleared the defer threshold by ~174B, a margin any
# future rules-file or preamble edit could silently flip without an obvious cause (see
# docs/solutions/best-practices/test-budget-margin-must-clear-threshold-with-headroom-2026-07-05.md).
# "onConflictDoNothing" is a database-body sentinel. Reusing the `database` domain here means
# this case and `itest-preest` below now exercise the same domain triple via different fixture
# files — an intentional trade of incidental domain-name diversity for margin robustness; the
# generic rank/defer/dedup machinery under test (domain_rank, EMITTED_FULL, DOMAIN_BUDGET) does
# not care which domain name triggers it.
#
# rules_section: extract only the "[RULES — <domain>]" body from an already-captured context
# blob, stopping at the next bracketed section header (same technique as sec_inline_bytes
# above). Scopes the sentinel check below to the RULES section so it can't accidentally match
# a LATER, unrelated block in the same blob — e.g. a "[SOLUTIONS — database]" list entry whose
# docs/solutions/ file TITLE happens to quote the same phrase — which would let the assertion
# pass even if the RULES-body catch-up itself regressed.
rules_section() {
  local domain="$1" text="$2"
  printf '%s\n' "$text" | awk -v hdr="[RULES — ${domain}]" '
    index($0, hdr) == 1 { f=1; next }
    /^\[(RULES|SOLUTIONS|TRUNCATED|NOTE)/ { f=0 }
    f'
}
DEFER_SESS='{"session_id":"itest-defer","tool_name":"Edit","tool_input":{"file_path":"shared/schema.ts"}}'
rm -f /tmp/ocrecipes-pattern-inject-itest-defer
d1=$(inline_ctx "$DEFER_SESS")
if grep -qF "[RULES — database] deferred" <<< "$d1" && ! grep -qF "onConflictDoNothing" <<< "$d1"; then
  echo "PASS: deferral → first touch defers database with a pointer, not a truncated body"; PASS=$((PASS + 1))
else
  echo "FAIL: deferral → first touch defers database with a pointer, not a truncated body"; FAIL=$((FAIL + 1))
fi
# database is pre-estimate-deferred here (its rules alone overflow the budget), so the perf
# skip means only its RULES body reaches the spill now — the solution refs are not built
# (asserted absent in the server/storage `itest-preest` case below). The full payload incl.
# solution refs auto-injects on the NEXT edit (asserted just below). This is the documented
# "rules now, solution refs next edit" recoverability trade.
# NOTE: use `grep -qF ... <<< "$(...)"` (here-string), NOT `echo "$(...)" | grep -qF ...`, for
# the rules_section-scoped checks below. The sentinel sits near the START of a multi-KB
# extracted section; `grep -q` exits the instant it matches, and under this file's `pipefail`
# (line 3) the upstream `echo`'s resulting SIGPIPE can make the pipeline report failure even
# though grep matched — a false negative. A here-string has no separate writer process to race.
defer_spill=""; [ -f "$SPILL_FILE" ] && defer_spill=$(cat "$SPILL_FILE")
if [ -n "$defer_spill" ] && grep -qF "onConflictDoNothing" <<< "$(rules_section database "$defer_spill")"; then
  echo "PASS: deferral → pre-estimated database ships its RULES body to the spill file now"; PASS=$((PASS + 1))
else
  echo "FAIL: deferral → pre-estimated database ships its RULES body to the spill file now"; FAIL=$((FAIL + 1))
fi
d2=$(inline_ctx "$DEFER_SESS")
# The FULL payload catches up on edit 2: both the rules body AND the solution refs that the
# pre-estimate skipped on edit 1 must now inject in full, alongside the dedup pointer for the
# already-emitted `security` domain. The sentinel check is scoped to the RULES — database
# section (rules_section) so a coincidental phrase match inside the SOLUTIONS — database list
# (real docs/solutions/ titles do contain "onConflictDoNothing") can't mask a RULES catch-up
# regression; see the here-string note above for why this uses `<<<` rather than a pipe.
if grep -qF "onConflictDoNothing" <<< "$(rules_section database "$d2")" && grep -qF "SOLUTIONS — database" <<< "$d2" && grep -qF "[RULES — security] already injected" <<< "$d2"; then
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

# PG Lab usage telemetry tail call: hook output must be BYTE-IDENTICAL whether logging is
# on (against a real, reachable lab DB), off (PATTERN_INJECT_NO_LOG=1, this suite's default),
# or the lab DB is unreachable — a logging failure must never surface in hook output. The
# "on" case uses a throwaway per-PID DB (never the shared ocrecipes_lab) so this suite never
# writes permanent rows into a developer's real telemetry ledger.
LOG_TEST_INPUT='{"session_id":"itest-hook-log-eq","tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}'
rm -f /tmp/ocrecipes-pattern-inject-itest-hook-log-eq
OUT_OFF=$(echo "$LOG_TEST_INPUT" | PATTERN_INJECT_NO_LOG=1 bash "$HOOK" 2>/dev/null)

rm -f /tmp/ocrecipes-pattern-inject-itest-hook-log-eq
OUT_DBDOWN=$(echo "$LOG_TEST_INPUT" | PATTERN_INJECT_NO_LOG=0 LAB_DATABASE_URL="postgresql://localhost/pg_lab_does_not_exist_$$" bash "$HOOK" 2>/dev/null)

LOG_TEST_DB="pg_lab_itest_hook_log_$$"
LOG_TEST_URL="postgresql://localhost/$LOG_TEST_DB"
LOG_TEST_HAS_PG=0
if command -v psql >/dev/null 2>&1 && psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
  LOG_TEST_HAS_PG=1
  LAB_DATABASE_URL="$LOG_TEST_URL" bash "$PROJECT_ROOT/scripts/pg-lab/init.sh" >/dev/null 2>&1
  psql -X -q -v ON_ERROR_STOP=1 -d "$LOG_TEST_URL" -f "$PROJECT_ROOT/scripts/pg-lab/schema/injection-log.sql" >/dev/null 2>&1
fi

if [ "$LOG_TEST_HAS_PG" = "1" ]; then
  rm -f /tmp/ocrecipes-pattern-inject-itest-hook-log-eq
  OUT_ON=$(echo "$LOG_TEST_INPUT" | PATTERN_INJECT_NO_LOG=0 LAB_DATABASE_URL="$LOG_TEST_URL" bash "$HOOK" 2>/dev/null)

  # Producer-side coverage: test-pg-lab-log-injection.sh proves the CONSUMER
  # (log-injection.sh + schema) correctly stores a hand-crafted agent_id field, but
  # nothing proves inject-patterns.sh's own LOG_TSV call sites actually POPULATE
  # $AGENT_ID end-to-end. Own session_id/agent_id (and own dedup-state file) so this
  # doesn't disturb the byte-identical OUT_ON assertion below. The tail call is
  # backgrounded + disowned (fire-and-forget, see inject-patterns.sh), so poll (15 x
  # 0.2s, matching test-session-coord.sh's windows) instead of asserting immediately.
  # TWO dispatches, same session/agent, dedup state left intact between them: the
  # first exercises the injected/deferred call sites, the second sends the
  # just-injected domain down the pointer call site — asserted separately with an
  # action filter, so dropping "$AGENT_ID" from either call site goes RED here
  # instead of hiding behind an unfiltered LIMIT 1.
  AGENTID_LOG_INPUT='{"session_id":"itest-hook-log-aid","agent_id":"itest-hook-log-aid-sub","tool_name":"Edit","tool_input":{"file_path":"server/routes/recipes.ts"}}'
  rm -f /tmp/ocrecipes-pattern-inject-itest-hook-log-aid-agent-itest-hook-log-aid-sub
  echo "$AGENTID_LOG_INPUT" | PATTERN_INJECT_NO_LOG=0 LAB_DATABASE_URL="$LOG_TEST_URL" bash "$HOOK" >/dev/null 2>&1
  echo "$AGENTID_LOG_INPUT" | PATTERN_INJECT_NO_LOG=0 LAB_DATABASE_URL="$LOG_TEST_URL" bash "$HOOK" >/dev/null 2>&1
  rm -f /tmp/ocrecipes-pattern-inject-itest-hook-log-aid-agent-itest-hook-log-aid-sub
  AID_ROW=""; AID_PTR_ROW=""
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    [ -z "$AID_ROW" ] && AID_ROW=$(psql -X -q -tA -d "$LOG_TEST_URL" -c "SELECT agent_id FROM harness.injection_log WHERE session_id='itest-hook-log-aid' AND action='injected' ORDER BY id LIMIT 1" 2>/dev/null)
    [ -z "$AID_PTR_ROW" ] && AID_PTR_ROW=$(psql -X -q -tA -d "$LOG_TEST_URL" -c "SELECT agent_id FROM harness.injection_log WHERE session_id='itest-hook-log-aid' AND action='pointer' ORDER BY id LIMIT 1" 2>/dev/null)
    [ -n "$AID_ROW" ] && [ -n "$AID_PTR_ROW" ] && break
    sleep 0.2
  done
  if [ "$AID_ROW" = "itest-hook-log-aid-sub" ]; then
    echo "PASS: producer wiring — injected-path LOG_TSV populates agent_id end-to-end"; PASS=$((PASS + 1))
  else
    echo "FAIL: producer wiring — injected-path LOG_TSV populates agent_id end-to-end — got: $AID_ROW"; FAIL=$((FAIL + 1))
  fi
  if [ "$AID_PTR_ROW" = "itest-hook-log-aid-sub" ]; then
    echo "PASS: producer wiring — pointer-path LOG_TSV populates agent_id end-to-end"; PASS=$((PASS + 1))
  else
    echo "FAIL: producer wiring — pointer-path LOG_TSV populates agent_id end-to-end — got: $AID_PTR_ROW"; FAIL=$((FAIL + 1))
  fi

  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$LOG_TEST_DB\" WITH (FORCE)" >/dev/null 2>&1
  if [ "$OUT_ON" = "$OUT_OFF" ] && [ "$OUT_ON" = "$OUT_DBDOWN" ]; then
    echo "PASS: hook output byte-identical across logging on/off/DB-down"; PASS=$((PASS + 1))
  else
    echo "FAIL: hook output byte-identical across logging on/off/DB-down"; FAIL=$((FAIL + 1))
  fi
else
  if [ "$OUT_OFF" = "$OUT_DBDOWN" ]; then
    echo "PASS: hook output byte-identical across logging off/DB-down (no local Postgres — 'on' case skipped)"; PASS=$((PASS + 1))
  else
    echo "FAIL: hook output byte-identical across logging off/DB-down"; FAIL=$((FAIL + 1))
  fi
fi
rm -f /tmp/ocrecipes-pattern-inject-itest-hook-log-eq
rm -f /tmp/ocrecipes-pattern-inject-itest-hook-log-aid-agent-itest-hook-log-aid-sub

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
