#!/usr/bin/env bash
# Unit test for session-recent-issues.sh. Run by CI (Lint · Types · Patterns job).
# Core focus: the FAIL-SILENT contract (the SessionStart digest must never block or error a
# session — it exits 0 with no output on a missing/empty corpus) plus the digest semantics:
# 14-day window, bug-track-first ordering, decoy exclusion (_manifests/, README.md), YAML
# scalar unwrapping, and the 12-row cap. Fixtures are temp trees via RECENT_SOLUTIONS_DIR.
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/session-recent-issues.sh"
FAIL=0
assert_empty()    { if [ -z "$2" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $2"; FAIL=1; fi; }
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_absent()   { if printf '%s' "$2" | grep -qF -- "$3"; then echo "FAIL: $1 — unexpectedly present: $3"; FAIL=1; else echo "ok: $1"; fi; }

command -v jq >/dev/null 2>&1 || { echo "skip: jq not installed"; exit 0; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
TODAY=$(date +%Y-%m-%d)

# Write a minimal solution file: mkfix <root> <relpath> <track> <created> <title>
mkfix() {
  local root="$1" rel="$2" track="$3" created="$4" title="$5"
  mkdir -p "$root/$(dirname "$rel")"
  printf -- "---\ntitle: '%s'\ntrack: %s\ncategory: %s\ntags: [test]\ncreated: '%s'\n---\n\n# %s\n" \
    "$title" "$track" "$(dirname "$rel")" "$created" "$title" > "$root/$rel"
}

# 1. Missing corpus dir → fail-silent: no output, exit 0.
OUT=$(RECENT_SOLUTIONS_DIR="$TMP/does-not-exist" bash "$HOOK"); RC=$?
assert_empty  "missing dir → no output" "$OUT"
assert_exit0  "missing dir → exit 0" "$RC"

# 2. Empty corpus dir → no in-window rows → fail-silent.
mkdir -p "$TMP/empty"
OUT=$(RECENT_SOLUTIONS_DIR="$TMP/empty" bash "$HOOK"); RC=$?
assert_empty  "empty dir → no output" "$OUT"
assert_exit0  "empty dir → exit 0" "$RC"

# 3. Populated corpus: recent bug + recent knowledge + out-of-window + excluded decoys.
FIX="$TMP/corpus"
mkfix "$FIX" "logic-errors/recent-bug-$TODAY.md"      bug       "$TODAY"     "A recent bug"
mkfix "$FIX" "conventions/recent-rule-$TODAY.md"      knowledge "$TODAY"     "A recent rule"
mkfix "$FIX" "conventions/old-rule-2020-01-01.md"     knowledge "2020-01-01" "An old rule"
mkfix "$FIX" "_manifests/manifest-decoy-$TODAY.md"    knowledge "$TODAY"     "A manifest decoy"
mkfix "$FIX" "README.md"                              knowledge "$TODAY"     "A readme decoy"
OUT=$(RECENT_SOLUTIONS_DIR="$FIX" bash "$HOOK"); RC=$?
assert_exit0 "populated corpus → exit 0" "$RC"
if printf '%s' "$OUT" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart" and (.hookSpecificOutput.additionalContext | type == "string" and length > 0)' >/dev/null 2>&1; then
  echo "ok: digest → valid SessionStart additionalContext JSON"
else
  echo "FAIL: digest shape wrong — got: $OUT"; FAIL=1
fi
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext')
assert_contains "recent bug listed"        "$CTX" "- $TODAY [bug/logic-errors] A recent bug — docs/solutions/logic-errors/recent-bug-$TODAY.md"
assert_contains "recent knowledge listed"  "$CTX" "- $TODAY [knowledge/conventions] A recent rule — docs/solutions/conventions/recent-rule-$TODAY.md"
assert_absent   "out-of-window excluded"   "$CTX" "An old rule"
assert_absent   "_manifests/ excluded"     "$CTX" "A manifest decoy"
assert_absent   "README.md excluded"       "$CTX" "A readme decoy"
BUG_LINE=$(printf '%s\n' "$CTX" | grep -nF "A recent bug" | cut -d: -f1)
RULE_LINE=$(printf '%s\n' "$CTX" | grep -nF "A recent rule" | cut -d: -f1)
if [ -n "$BUG_LINE" ] && [ -n "$RULE_LINE" ] && [ "$BUG_LINE" -lt "$RULE_LINE" ]; then
  echo "ok: bug-track ordered before knowledge-track"
else
  echo "FAIL: expected bug line ($BUG_LINE) before knowledge line ($RULE_LINE)"; FAIL=1
fi

# 4. YAML scalar unwrap: doubled single quote in a single-quoted title surfaces unescaped.
FIX2="$TMP/quoting"
mkfix "$FIX2" "conventions/quoted-title-$TODAY.md" knowledge "$TODAY" "It''s a quoted title"
CTX=$(RECENT_SOLUTIONS_DIR="$FIX2" bash "$HOOK" | jq -r '.hookSpecificOutput.additionalContext')
assert_contains "single-quote unescape" "$CTX" "It's a quoted title"

# 5. Cap: 14 in-window files → exactly 12 rows.
FIX3="$TMP/cap"
for i in 01 02 03 04 05 06 07 08 09 10 11 12 13 14; do
  mkfix "$FIX3" "conventions/capped-$i-$TODAY.md" knowledge "$TODAY" "Capped $i"
done
CTX=$(RECENT_SOLUTIONS_DIR="$FIX3" bash "$HOOK" | jq -r '.hookSpecificOutput.additionalContext')
ROWCOUNT=$(printf '%s\n' "$CTX" | grep -c '^- ')
if [ "$ROWCOUNT" -eq 12 ]; then
  echo "ok: 14 in-window files cap to 12 rows"
else
  echo "FAIL: expected 12 rows, got $ROWCOUNT"; FAIL=1
fi

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
