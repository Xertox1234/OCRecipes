#!/usr/bin/env bash
# Self-test — inject-patterns.sh SOLUTION SELECTION (relevance vs recency).
#
# Scope: solutions_from_markdown's candidate selection and reserve_bug_slot. The sibling
# test-inject-patterns.sh covers domain routing, dedup, deferral, spill and telemetry; this file
# deliberately covers NONE of that, and is built so none of it can fire (see "Isolation" below).
#
# Isolation — every choice here exists to keep a failure attributable to selection alone:
#   * The hook + lib/domain-map.sh are copied into a mktemp -d tree. PROJECT_ROOT derives from
#     ${BASH_SOURCE[0]}, so SOLUTIONS_DIR resolves inside the temp tree automatically and no
#     production seam (env override) is needed. The hook under test is byte-identical to prod.
#   * NO docs/rules/ in the temp tree. The rules `cat` is [ -f ]-guarded, so payloads stay ~1.5KB
#     and the DOMAIN_BUDGET / pre-estimate / deferral / spill machinery can never fire. Byte
#     budgets are therefore NOT coupled to these tests.
#   * Session-less input (no session_id) => DEDUP=0 => no /tmp state, no pointer branch.
#     It also means we never touch the shared /tmp/ocrecipes-pattern-inject-* files that a
#     concurrent session may be using.
#   * cwd is the temp tree — load-bearing for the noglob test (test 5).
#   * Fixtures live ONLY in mktemp -d. Never write fixtures into the real docs/solutions/: they
#     would become live-injectable and would trip scripts/check-solution-frontmatter.js.
#
# Fixture path client/context/AuthContext.tsx maps to exactly ONE domain (client-state), so
# exactly one SOLUTIONS block is emitted and assertions cannot be confused by a second domain.
set -uo pipefail

# Never write the shared pg-lab telemetry table from a test run.
export PATTERN_INJECT_NO_LOG=1

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0

T=$(mktemp -d)
cleanup() { rm -rf "$T"; return 0; }
trap cleanup EXIT

mkdir -p "$T/.claude/hooks/lib"
cp "$HOOK_DIR/inject-patterns.sh" "$T/.claude/hooks/inject-patterns.sh"
cp "$HOOK_DIR/lib/domain-map.sh" "$T/.claude/hooks/lib/domain-map.sh"

HOOK="$T/.claude/hooks/inject-patterns.sh"
EDITED="client/context/AuthContext.tsx" # -> client-state, single domain

# ---------------------------------------------------------------------------
# fixture + assertion helpers
# ---------------------------------------------------------------------------

reset_corpus() {
  rm -rf "$T/docs/solutions"
  mkdir -p "$T/docs/solutions"
}

# sol <category/name-YYYY-MM-DD.md> <tags-csv> <applies_to-csv-or-empty> <title>
# Frontmatter mirrors the corpus invariant: single-line inline-flow arrays.
sol() {
  local p="$T/docs/solutions/$1"
  mkdir -p "$(dirname "$p")"
  {
    printf -- '---\n'
    printf 'title: %s\n' "$4"
    printf 'tags: [%s]\n' "$2"
    [ -n "$3" ] && printf 'applies_to: [%s]\n' "$3"
    printf -- '---\n\nbody\n'
  } >"$p"
}

# ctx <repo-relative-path> -> the inline additionalContext string.
# Runs with cwd=$T so an accidentally glob-expanded applies_to pattern would resolve against
# the fixture tree (test 5 depends on this).
ctx() {
  (
    cd "$T" || exit 1
    printf '{"tool_name":"Edit","tool_input":{"file_path":"%s/%s"}}' "$T" "$1" |
      bash "$HOOK" 2>/dev/null
  ) | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null || true
}

# sols <repo-relative-path> -> just the solution reference lines, in emitted order.
sols() {
  ctx "$1" | grep '^- docs/solutions/' || true
}

assert_has() { # <name> <output> <needle>
  if printf '%s\n' "$2" | grep -qF -- "$3"; then
    echo "PASS: $1"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $1"
    echo "      expected to find: $3"
    printf '      got:\n%s\n' "$(printf '%s\n' "$2" | sed 's/^/        /')"
    FAIL=$((FAIL + 1))
  fi
}

assert_lacks() { # <name> <output> <needle>
  if printf '%s\n' "$2" | grep -qF -- "$3"; then
    echo "FAIL: $1"
    echo "      expected NOT to find: $3"
    printf '      got:\n%s\n' "$(printf '%s\n' "$2" | sed 's/^/        /')"
    FAIL=$((FAIL + 1))
  else
    echo "PASS: $1"
    PASS=$((PASS + 1))
  fi
}

assert_count() { # <name> <output> <expected-line-count>
  local n
  n=$(printf '%s\n' "$2" | grep -c '^- docs/solutions/' || true)
  if [ "$n" -eq "$3" ]; then
    echo "PASS: $1"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $1 (expected $3 refs, got $n)"
    printf '      got:\n%s\n' "$(printf '%s\n' "$2" | sed 's/^/        /')"
    FAIL=$((FAIL + 1))
  fi
}

assert_before() { # <name> <output> <first> <second>
  local a b
  a=$(printf '%s\n' "$2" | grep -nF -- "$3" | head -1 | cut -d: -f1)
  b=$(printf '%s\n' "$2" | grep -nF -- "$4" | head -1 | cut -d: -f1)
  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then
    echo "PASS: $1"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $1 (expected '$3' before '$4'; positions a=${a:-missing} b=${b:-missing})"
    printf '      got:\n%s\n' "$(printf '%s\n' "$2" | sed 's/^/        /')"
    FAIL=$((FAIL + 1))
  fi
}

# ---------------------------------------------------------------------------
# 1. CAP#1 — relevance must be consulted BEFORE the date cut
# ---------------------------------------------------------------------------
reset_corpus
for d in 09 08 07 06 05 04 03 02 01; do
  sol "conventions/general-2026-08-${d}.md" "client-state" "" "General ${d}"
done
sol "design-patterns/exact-old-2026-01-01.md" "client-state" "$EDITED" "Exact old match"
out=$(sols "$EDITED")
assert_has "CAP#1 — an applies_to match outside the date window is promoted" \
  "$out" "design-patterns/exact-old-2026-01-01.md"

# ---------------------------------------------------------------------------
# 2. CAP#2 — bash [[ ]] has no globstar: dir/**/*.ext must match dir/file.ext
# ---------------------------------------------------------------------------
reset_corpus
for d in 06 05 04 03 02 01; do
  sol "conventions/general-2026-08-${d}.md" "client-state" "" "General ${d}"
done
sol "design-patterns/doublestar-2026-07-30.md" "client-state" "client/context/**/*.tsx" "Doublestar glob"
out=$(sols "$EDITED")
assert_has "CAP#2 — dir/**/*.ext matches dir/file.ext (no intermediate directory)" \
  "$out" "design-patterns/doublestar-2026-07-30.md"

# ---------------------------------------------------------------------------
# 3. CAP#2 negative control — eliding **/ must NOT match a different subtree
# ---------------------------------------------------------------------------
reset_corpus
for d in 04 03 02 01; do
  sol "conventions/general-2026-08-${d}.md" "client-state" "" "General ${d}"
done
sol "design-patterns/wrong-subtree-2026-01-01.md" "client-state" "client/hooks/**/*.tsx" "Wrong subtree"
out=$(sols "$EDITED")
assert_lacks "CAP#2 negative control — **/-stripping does not match a different subtree" \
  "$out" "design-patterns/wrong-subtree-2026-01-01.md"

# ---------------------------------------------------------------------------
# 4. CAP#2 regression guard — the pre-existing nested case must keep working
# ---------------------------------------------------------------------------
reset_corpus
for d in 04 03 02 01; do
  sol "conventions/general-2026-08-${d}.md" "client-state" "" "General ${d}"
done
sol "design-patterns/nested-2026-01-01.md" "client-state" "client/context/**/*.tsx" "Nested match"
out=$(sols "client/context/nested/Deep.tsx")
assert_has "CAP#2 regression guard — dir/**/*.ext still matches dir/sub/file.ext" \
  "$out" "design-patterns/nested-2026-01-01.md"

# ---------------------------------------------------------------------------
# 5. applies_to globs must not be pathname-expanded (set -f)
#    Without noglob, `client/context/**/*.tsx` expands against cwd=$T to the real file
#    client/context/sub/Other.tsx, which then does NOT match the edited path — silently
#    dropping the promotion. This pins that regression.
# ---------------------------------------------------------------------------
reset_corpus
mkdir -p "$T/client/context/sub"
: >"$T/client/context/sub/Other.tsx"
for d in 05 04 03 02 01; do
  sol "conventions/general-2026-08-${d}.md" "client-state" "" "General ${d}"
done
sol "design-patterns/noglob-2026-01-01.md" "client-state" "client/context/**/*.tsx" "Noglob probe"
out=$(sols "$EDITED")
assert_has "applies_to globs are not pathname-expanded (set -f)" \
  "$out" "design-patterns/noglob-2026-01-01.md"

# ---------------------------------------------------------------------------
# 6. Specificity — an exact path match outranks a broad glob match
# ---------------------------------------------------------------------------
reset_corpus
sol "conventions/broad-2026-08-01.md" "client-state" "client/**/*.tsx" "Broad glob"
for d in 05 04 03; do
  sol "conventions/mid-2026-07-${d}.md" "client-state" "" "Mid ${d}"
done
sol "design-patterns/exact-2026-02-01.md" "client-state" "$EDITED" "Exact match"
out=$(sols "$EDITED")
assert_before "exact applies_to outranks a broad glob match" \
  "$out" "design-patterns/exact-2026-02-01.md" "conventions/broad-2026-08-01.md"

# ---------------------------------------------------------------------------
# 7. Cap — never more than SOLUTIONS_PER_DOMAIN refs for a domain
# ---------------------------------------------------------------------------
reset_corpus
for d in 01 02 03 04 05 06 07 08 09 10 11 12; do
  sol "conventions/many-2026-07-${d}.md" "client-state" "$EDITED" "Many ${d}"
done
out=$(sols "$EDITED")
assert_count "at most SOLUTIONS_PER_DOMAIN refs per domain" "$out" 4

# ---------------------------------------------------------------------------
# 8. reserve_bug_slot — a bug-track ref outside the natural top-4 claims the last slot
# ---------------------------------------------------------------------------
reset_corpus
for d in 04 03 02 01; do
  sol "conventions/knowledge-2026-08-${d}.md" "client-state" "$EDITED" "Knowledge ${d}"
done
sol "logic-errors/bug-2026-07-31.md" "client-state" "$EDITED" "Bug track"
out=$(sols "$EDITED")
assert_has "reserve_bug_slot — a bug-track ref outside the natural top-4 takes the last slot" \
  "$out" "logic-errors/bug-2026-07-31.md"
assert_lacks "reserve_bug_slot — the displaced 4th knowledge ref is dropped" \
  "$out" "conventions/knowledge-2026-08-01.md"

# ---------------------------------------------------------------------------
# 9. reserve_bug_slot — with no bug-track candidates the natural top-4 is untouched
#    (also guards the empty-`rest` branch against a set -u crash on bash 3.2)
# ---------------------------------------------------------------------------
reset_corpus
for d in 06 05 04 03 02 01; do
  sol "conventions/knowledge-2026-08-${d}.md" "client-state" "$EDITED" "Knowledge ${d}"
done
out=$(sols "$EDITED")
assert_has "reserve_bug_slot — no bug-track candidates leaves the natural top-4 intact" \
  "$out" "conventions/knowledge-2026-08-03.md"
assert_lacks "reserve_bug_slot — no bug-track candidates: 5th newest stays out" \
  "$out" "conventions/knowledge-2026-08-02.md"

# ---------------------------------------------------------------------------
# 10. Degenerate input — one tagged solution must not crash the empty-array path
# ---------------------------------------------------------------------------
reset_corpus
sol "conventions/only-2026-08-01.md" "client-state" "" "Only one"
out=$(ctx "$EDITED")
assert_has "single tagged solution — valid output, one ref emitted" \
  "$out" "conventions/only-2026-08-01.md"
assert_count "single tagged solution — exactly one ref" "$out" 1

# ---------------------------------------------------------------------------
# 11. General tier still ranks by date when nothing declares applies_to
# ---------------------------------------------------------------------------
reset_corpus
for d in 05 04 03 02 01; do
  sol "conventions/dateonly-2026-08-${d}.md" "client-state" "" "Date only ${d}"
done
out=$(sols "$EDITED")
assert_has "a solution with no applies_to still ranks by date in the general tier" \
  "$out" "conventions/dateonly-2026-08-05.md"
assert_lacks "general tier — the 5th newest stays out" \
  "$out" "conventions/dateonly-2026-08-01.md"

# ---------------------------------------------------------------------------
# 12. Quoted applies_to entries are unquoted before matching
# ---------------------------------------------------------------------------
reset_corpus
for d in 05 04 03 02 01; do
  sol "conventions/general-2026-08-${d}.md" "client-state" "" "General ${d}"
done
sol "design-patterns/quoted-2026-01-02.md" "client-state" '"client/context/**/*.tsx"' "Double quoted"
sol "design-patterns/squoted-2026-01-01.md" "client-state" "'client/context/**/*.tsx'" "Single quoted"
out=$(sols "$EDITED")
assert_has "quoted applies_to entries are unquoted before matching (double)" \
  "$out" "design-patterns/quoted-2026-01-02.md"
assert_has "quoted applies_to entries are unquoted before matching (single)" \
  "$out" "design-patterns/squoted-2026-01-01.md"

# ---------------------------------------------------------------------------
# 13. Multi-entry applies_to — a match on a NON-first entry is honored
#     The 2nd element carries a leading space after the comma split; guards the trim.
# ---------------------------------------------------------------------------
reset_corpus
for d in 05 04 03 02 01; do
  sol "conventions/general-2026-08-${d}.md" "client-state" "" "General ${d}"
done
sol "design-patterns/multi-2026-01-01.md" "client-state" \
  "server/routes/**/*.ts, client/context/**/*.tsx" "Multi entry"
out=$(sols "$EDITED")
assert_has "multi-entry applies_to — a match on a non-first entry is honored" \
  "$out" "design-patterns/multi-2026-01-01.md"

# ---------------------------------------------------------------------------
# 14. A domain with zero tagged solutions emits no SOLUTIONS block
# ---------------------------------------------------------------------------
reset_corpus
sol "conventions/other-domain-2026-08-01.md" "database" "" "Other domain"
out=$(ctx "$EDITED")
assert_lacks "domain with zero tagged solutions emits no SOLUTIONS block" \
  "$out" "[SOLUTIONS — client-state]"

# ---------------------------------------------------------------------------
# 15. reserve_bug_slot across TIERS — the swap pool is now tier-ordered, not date-ordered.
#     Four applies_to matches fill the top slots; the only bug-track solution is reachable
#     solely through the general tier and must still claim the last slot.
# ---------------------------------------------------------------------------
reset_corpus
for d in 04 03 02 01; do
  sol "conventions/matched-2026-07-${d}.md" "client-state" "$EDITED" "Matched ${d}"
done
sol "logic-errors/general-bug-2026-08-09.md" "client-state" "" "General-tier bug"
out=$(sols "$EDITED")
assert_has "reserve_bug_slot — a bug-track ref in the GENERAL tier still takes the last slot" \
  "$out" "logic-errors/general-bug-2026-08-09.md"

# ---------------------------------------------------------------------------
echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
