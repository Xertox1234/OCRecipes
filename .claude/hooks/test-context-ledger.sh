#!/usr/bin/env bash
# Tests for the context-ledger hooks — run from project root.
# Hermetic: CONTEXT_LEDGER_ROOT redirects all state into a temp dir, so a run never
# touches a real session's ledger.
set -uo pipefail

HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0

TMPROOT=$(mktemp -d) || exit 1
export CONTEXT_LEDGER_ROOT="$TMPROOT/ledger"
trap 'rm -rf "$TMPROOT"' EXIT

. "$HOOKS_DIR/lib/context-ledger-path.sh" || { echo "FAIL: cannot source lib"; exit 1; }

ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
no() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# --- Task 1: path resolution + sanitiser ---

out=$(context_ledger_dir "abc-123" 2>/dev/null)
[ "$out" = "$CONTEXT_LEDGER_ROOT/abc-123" ] \
  && ok "valid session id resolves under the test root" \
  || no "valid session id resolved to [$out]"

# Test 8 (spec §8): sanitiser. Asserted DIRECTLY, not inferred from a green suite.
# Contract is "return 1 AND print nothing" — both halves are checked, so a mutant
# that printed a path before `return 1` cannot pass.
for bad in "" "../etc" "a/b" 'a;rm -rf /' '$(whoami)' ".." "."; do
  out=$(context_ledger_dir "$bad" 2>/dev/null); rc=$?
  if [ $rc -eq 0 ] || [ -n "$out" ]; then
    no "sanitiser ACCEPTED or printed for bad id: [$bad] rc=$rc out=[$out]"
  else
    ok "sanitiser rejected [$bad]"
  fi
done

# Production default path (spec §8): pin the real, non-test branch so a later task's
# hardcoded reference to this exact string can't drift silently. Unset in a subshell so
# the hermetic CONTEXT_LEDGER_ROOT export above is untouched for every other case.
out=$( unset CONTEXT_LEDGER_ROOT; context_ledger_dir "abc-123" 2>/dev/null )
if [ "$out" = "/tmp/ocrecipes-context-ledger-abc-123" ]; then
  ok "production default path pinned"
else
  no "production default path drifted: [$out]"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
